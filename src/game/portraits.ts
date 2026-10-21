// 초상화 그리기. 그림 연결이 없으면 아무것도 하지 않는다.
//
// - 그림 연결 = settings.routing.image 가 가리키는 이미지 프로필
// - 프롬프트 = 월드 화풍 태그 + 캐릭터 그림용 태그 + 초상화 구도 태그 (항상 영어, PLAN 4-3)
// - 연결별 큐(한 번에 하나, 최소 간격)는 paintQueued가 지킨다
// - 같은 캐릭터를 동시에 두 번 그리지 않는다 (inFlight)
import { db, getSettings } from '../db';
import { newId, now } from '../core/id';
import { paintQueued, toImageError, toWebp } from '../gen/image';
import { useLiveQuery } from '../ui/hooks';
import type { Asset, Character, Id, ImageProfile, World } from '../types';

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

/** 화풍 태그 + 캐릭터 태그 + 구도 태그 순서로 조립 */
export function buildPortraitPrompt(world: Pick<World, 'art'> | undefined, character: Pick<Character, 'imageTags'>): { prompt: string; negativePrompt: string } {
  return {
    prompt: joinTags(world?.art.positiveTags, character.imageTags, PORTRAIT_FRAMING_TAGS),
    negativePrompt: joinTags(world?.art.negativeTags, DEFAULT_NEGATIVE_TAGS),
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
  const p = doPaint(characterId, opts).finally(() => inFlight.delete(characterId));
  inFlight.set(characterId, p);
  return p;
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
  const { prompt, negativePrompt } = buildPortraitPrompt(world, character);
  const width = profile.width > 0 ? profile.width : FALLBACK_SIZE.width;
  const height = profile.height > 0 ? profile.height : FALLBACK_SIZE.height;

  let result;
  try {
    result = await paintQueued(profile, { prompt, negativePrompt, width, height, signal }, priority);
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
