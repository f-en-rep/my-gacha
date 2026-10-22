// 초상화 그리기. 그림 연결이 없으면 아무것도 하지 않는다.
//
// - 그림 연결 = settings.routing.image 가 가리키는 이미지 프로필
// - 공통 프롬프트 = 연결의 메인 프롬프트 + 월드 화풍 태그 + 초상화 구도 태그 (항상 영어, PLAN 4-3)
// - 캐릭터 프롬프트 = 캐릭터 그림용 태그 (+ 캐릭터 네거티브). NovelAI V4 이상은 캐릭터 슬롯으로,
//   슬롯이 없는 모델은 공통 프롬프트 뒤에 이어 붙는다 (gen/image가 처리)
// - 연결별 큐(한 번에 하나, 최소 간격)는 paintQueued가 지킨다
// - 같은 캐릭터를 동시에 두 번 그리지 않는다 (inFlight)
// - 실패하면 알림. 뒤에서(background) 그린 것은 다 그렸을 때도 알림 (취소는 빼고)
import { db, getSettings } from '../db';
import { newId, now } from '../core/id';
import { paintQueued, toImageError, toWebp } from '../gen/image';
import { useLiveQuery } from '../ui/hooks';
import type { CharacterPrompt } from '../gen/image/types';
import { addNotice, noticeFailure, resolveNotice } from './notices';
import type { Asset, Character, Id, ImageGenSettings, ImageProfile, World } from '../types';

export interface PaintOptions {
  priority?: 'foreground' | 'background';
  /** 이미 있어도 다시 그리기 */
  force?: boolean;
  signal?: AbortSignal;
}

/** 가챠 캐릭터 초상화 구도 (상황 태그) */
export const PORTRAIT_FRAMING_TAGS = 'solo, upper body, looking at viewer, simple background';

/** 월드가 따로 정하지 않아도 늘 붙이는 기본 네거티브 */
export const DEFAULT_NEGATIVE_TAGS =
  'lowres, worst quality, low quality, bad anatomy, bad hands, extra digits, fewer digits, missing fingers, cropped, jpeg artifacts, text, signature, watermark, username, blurry, multiple views';

const FALLBACK_SIZE = { width: 832, height: 1216 };

/** 쉼표로 나눈 태그들을 이어 붙인다. 빈 칸과 (대소문자 무시) 중복은 뺀다 */
export function joinTags(...parts: (string | undefined)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    for (const raw of (part ?? '').split(',')) {
      const tag = raw.trim();
      const key = tag.toLowerCase();
      if (!tag || seen.has(key)) continue;
      seen.add(key);
      out.push(tag);
    }
  }
  return out.join(', ');
}

export interface PortraitPrompt {
  /** 공통 프롬프트: 메인 프롬프트 + 화풍 + 구도 */
  prompt: string;
  negativePrompt: string;
  /** 캐릭터 슬롯 */
  characters: CharacterPrompt[];
}

/**
 * 초상화 프롬프트 조립.
 * 네거티브: 연결에 적은 네거티브가 있으면 그것, 없으면 앱 기본 네거티브. 여기에 월드 네거티브를 더한다.
 */
export function buildPortraitPrompt(
  world: Pick<World, 'art'> | undefined,
  character: Pick<Character, 'imageTags' | 'imageNegative'>,
  gen?: ImageGenSettings,
): PortraitPrompt {
  return {
    prompt: joinTags(gen?.positive, world?.art.positiveTags, PORTRAIT_FRAMING_TAGS),
    negativePrompt: joinTags(gen?.negative?.trim() ? gen.negative : DEFAULT_NEGATIVE_TAGS, world?.art.negativeTags),
    characters: [{ prompt: joinTags(character.imageTags), negative: joinTags(character.imageNegative) || undefined }],
  };
}

/** 지정된 그림 연결 프로필. 없거나 그림 프로필이 아니면 undefined */
export async function getImageProfile(): Promise<ImageProfile | undefined> {
  const s = await getSettings();
  const id = s.routing.image;
  if (!id) return undefined;
  const p = await db.profiles.get(id);
  return p?.type === 'image' ? p : undefined;
}

/** 그림 연결이 지정되어 있는지 */
export function usePaintAvailable(): boolean {
  return useLiveQuery(async () => !!(await getImageProfile()), []) ?? false;
}

const inFlight = new Map<Id, Promise<Id | undefined>>();

/** 지금 그리는 중인지 (같은 탭 안에서) */
export function isPainting(characterId: Id): boolean {
  return inFlight.has(characterId);
}

/**
 * 캐릭터 초상화를 그려 Asset으로 저장하고 Character.portraitId를 채운다. 만든 Asset id를 돌려준다.
 * 그림 연결이 없으면 undefined. 같은 캐릭터를 동시에 두 번 그리지 않는다.
 * 이미 초상화가 있으면 (force가 아니면) 그리지 않고 그 id를 돌려준다.
 */
export function paintPortrait(characterId: Id, opts: PaintOptions = {}): Promise<Id | undefined> {
  const running = inFlight.get(characterId);
  if (running) return running;
  const p = withNotice(characterId, opts, () => doPaint(characterId, opts)).finally(() => inFlight.delete(characterId));
  inFlight.set(characterId, p);
  return p;
}

/** 그린 결과를 알림으로 (실패는 언제나, 완료는 뒤에서 새로 그렸을 때만) */
async function withNotice(characterId: Id, opts: PaintOptions, job: () => Promise<Id | undefined>): Promise<Id | undefined> {
  const key = `portrait:${characterId}`;
  const before = opts.force ? undefined : (await db.characters.get(characterId).catch(() => undefined))?.portraitId;
  try {
    const id = await job();
    if (id) await resolveNotice(key);
    if (id && id !== before && (opts.priority ?? 'background') === 'background') {
      const c = await db.characters.get(characterId);
      if (c) await addNotice({ key, kind: 'done', job: 'portrait', title: `${c.name}의 초상화를 그렸어요`, link: `/characters/${encodeURIComponent(c.id)}`, worldId: c.worldId });
    }
    return id;
  } catch (e) {
    const c = await db.characters.get(characterId).catch(() => undefined);
    await noticeFailure(
      { key, job: 'portrait', title: `${c?.name ?? '캐릭터'}의 초상화를 그리지 못했어요`, link: `/characters/${encodeURIComponent(characterId)}`, worldId: c?.worldId },
      e,
      opts.signal,
    );
    throw e;
  }
}

async function existingPortrait(c: Character): Promise<Id | undefined> {
  if (!c.portraitId) return undefined;
  return (await db.assets.get(c.portraitId)) ? c.portraitId : undefined;
}

async function doPaint(characterId: Id, opts: PaintOptions): Promise<Id | undefined> {
  const { priority = 'background', force = false, signal } = opts;
  const profile = await getImageProfile();
  if (!profile) return undefined;

  const character = await db.characters.get(characterId);
  if (!character) throw new Error('캐릭터를 찾을 수 없습니다.');
  if (!force) {
    const have = await existingPortrait(character);
    if (have) return have;
  }
  const world = await db.worlds.get(character.worldId);
  const { prompt, negativePrompt, characters } = buildPortraitPrompt(world, character, profile.gen);
  const width = profile.width > 0 ? profile.width : FALLBACK_SIZE.width;
  const height = profile.height > 0 ? profile.height : FALLBACK_SIZE.height;

  let result;
  try {
    result = await paintQueued(profile, { prompt, negativePrompt, characters, width, height, signal }, priority);
  } catch (e) {
    throw toImageError(profile.provider, e, profile.useRelay);
  }
  const blob = await toWebp(result.blob);

  return db.transaction('rw', db.characters, db.assets, async () => {
    // 그리는 동안 바뀌었을 수 있으니 다시 읽는다
    const cur = await db.characters.get(characterId);
    if (!cur) throw new Error('그리는 동안 캐릭터가 지워졌습니다.');
    if (!force) {
      const have = await existingPortrait(cur);
      if (have) return have;
    }
    const asset: Asset = {
      id: newId('asset_'),
      worldId: cur.worldId,
      mime: blob.type || result.mime,
      blob,
      width: result.width,
      height: result.height,
      prompt: result.prompt || prompt,
      negativePrompt: result.negativePrompt || negativePrompt,
      seed: result.seed,
      provider: profile.provider,
      createdAt: now(),
    };
    await db.assets.put(asset);
    if (cur.portraitId && cur.portraitId !== asset.id) await db.assets.delete(cur.portraitId);
    await db.characters.put({ ...cur, portraitId: asset.id, updatedAt: now() });
    return asset.id;
  });
}
