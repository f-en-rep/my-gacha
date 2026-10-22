// 배너 그림 그리기 (가로 키 비주얼). 그림 연결이 없으면 아무것도 하지 않는다.
//
// - 공통 프롬프트 = (여러 명이면 인원 태그) + 연결의 메인 프롬프트 + 월드 화풍 + 배너 구도 태그
// - 캐릭터 = 픽업 캐릭터 최대 3명 (6★ 먼저, 다음 5★). NovelAI V4 이상은 캐릭터 슬롯으로 따로,
//   슬롯이 없는 모델은 공통 프롬프트 뒤에 이어 붙는다 (gen/image가 처리)
// - 같은 배너를 동시에 두 번 그리지 않는다 (inFlight)
// - 다 그리면·실패하면 알림 (취소는 빼고)
import { db } from '../db';
import { newId, now } from '../core/id';
import { paintQueued, toImageError, toWebp } from '../gen/image';
import type { CharacterPrompt } from '../gen/image/types';
import type { Asset, Banner, Character, Id, ImageGenSettings, World } from '../types';
import { DEFAULT_NEGATIVE_TAGS, getImageProfile, joinTags, type PaintOptions } from './portraits';
import { addNotice, noticeFailure, resolveNotice } from './notices';

/** 배너 그림 구도 태그 */
export const BANNER_FRAMING_TAGS = 'key visual, banner art, dynamic composition, detailed background';
/** 배너 그림 크기 (가로) */
export const BANNER_SIZE = { width: 1216, height: 832 } as const;
/** 배너 그림에 넣는 최대 인원 */
export const BANNER_MAX_CHARACTERS = 3;

type Subject = 'girl' | 'boy' | 'other';
const SUBJECT_RE = /^(\d+)\+?\s*(girl|boy|other)s?$/i;
const MULTI_RE = /^multiple (girls|boys|others)$/i;

/** 캐릭터 그림 태그의 첫 인원 태그 → girl/boy/other. 못 읽으면 other */
export function subjectOf(imageTags: string): Subject {
  for (const raw of imageTags.split(',')) {
    const t = raw.trim();
    const m = SUBJECT_RE.exec(t);
    if (m) return m[2]!.toLowerCase() as Subject;
    const mm = MULTI_RE.exec(t);
    if (mm) return mm[1]!.toLowerCase().replace(/s$/, '') as Subject;
  }
  return 'other';
}

/** 여러 명일 때 공통 프롬프트 앞에 붙는 인원 태그 ("2girls", "1girl, 1boy" ...). 한 명 이하면 빈 글 */
export function countTags(characters: Pick<Character, 'imageTags'>[]): string {
  if (characters.length < 2) return '';
  const n: Record<Subject, number> = { girl: 0, boy: 0, other: 0 };
  for (const c of characters) n[subjectOf(c.imageTags)]++;
  const out: string[] = [];
  for (const s of ['girl', 'boy', 'other'] as const) {
    const k = n[s];
    if (k === 0) continue;
    out.push(k >= 6 ? `multiple ${s}s` : k === 1 ? `1${s}` : `${k}${s}s`);
  }
  return out.join(', ');
}

/** 그림에 넣을 픽업 캐릭터: 6★ 먼저, 다음 5★, 최대 3명 */
export function bannerCharacters(banner: Pick<Banner, 'featured6' | 'featured5'>, cast: Character[]): Character[] {
  const byId = new Map(cast.map((c) => [c.id, c]));
  const out: Character[] = [];
  for (const id of [...banner.featured6, ...banner.featured5]) {
    const c = byId.get(id);
    if (c && !out.includes(c)) out.push(c);
    if (out.length >= BANNER_MAX_CHARACTERS) break;
  }
  return out;
}

export interface BannerArtPrompt {
  prompt: string;
  negativePrompt: string;
  characters: CharacterPrompt[];
}

/** 배너 그림 프롬프트 조립. 여러 명이면 캐릭터 태그에서 solo를 뺀다 */
export function buildBannerArtPrompt(world: Pick<World, 'art'> | undefined, characters: Pick<Character, 'imageTags' | 'imageNegative'>[], gen?: ImageGenSettings): BannerArtPrompt {
  const multi = characters.length > 1;
  return {
    prompt: joinTags(countTags(characters), gen?.positive, world?.art.positiveTags, BANNER_FRAMING_TAGS),
    negativePrompt: joinTags(gen?.negative?.trim() ? gen.negative : DEFAULT_NEGATIVE_TAGS, world?.art.negativeTags),
    characters: characters.map((c) => ({
      prompt: joinTags(
        ...c.imageTags
          .split(',')
          .map((t) => t.trim())
          .filter((t) => !(multi && /^solo$/i.test(t))),
      ),
      negative: joinTags(c.imageNegative) || undefined,
    })),
  };
}

const inFlight = new Map<Id, Promise<Id | undefined>>();

/** 이 배너를 지금 그리는 중인지 (같은 탭 안에서) */
export function isPaintingBanner(bannerId: Id): boolean {
  return inFlight.has(bannerId);
}

/**
 * 배너 그림을 그려 Asset으로 저장하고 Banner.artId를 채운다. 만든 Asset id를 돌려준다.
 * 그림 연결이 없으면 undefined. 이미 그림이 있으면 (force가 아니면) 그 id. force면 옛 그림은 지운다.
 */
export function paintBannerArt(bannerId: Id, opts: PaintOptions = {}): Promise<Id | undefined> {
  const running = inFlight.get(bannerId);
  if (running) return running;
  const key = `banner-art:${bannerId}`;
  const link = `/pull/edit/${encodeURIComponent(bannerId)}`;
  const p = (async () => {
    const before = opts.force ? undefined : (await db.banners.get(bannerId).catch(() => undefined))?.artId;
    try {
      const id = await doPaint(bannerId, opts);
      if (id) await resolveNotice(key);
      if (id && id !== before) {
        const b = await db.banners.get(bannerId);
        if (b) await addNotice({ key, kind: 'done', job: 'banner-art', title: `배너 「${b.name}」 그림을 그렸어요`, link, worldId: b.worldId });
      }
      return id;
    } catch (e) {
      const b = await db.banners.get(bannerId).catch(() => undefined);
      await noticeFailure({ key, job: 'banner-art', title: `배너 「${b?.name ?? '배너'}」 그림을 그리지 못했어요`, link, worldId: b?.worldId }, e, opts.signal);
      throw e;
    }
  })().finally(() => inFlight.delete(bannerId));
  inFlight.set(bannerId, p);
  return p;
}

async function existingArt(b: Banner): Promise<Id | undefined> {
  if (!b.artId) return undefined;
  return (await db.assets.get(b.artId)) ? b.artId : undefined;
}

async function doPaint(bannerId: Id, opts: PaintOptions): Promise<Id | undefined> {
  const { priority = 'foreground', force = false, signal } = opts;
  const profile = await getImageProfile();
  if (!profile) return undefined;

  const banner = await db.banners.get(bannerId);
  if (!banner) throw new Error('배너를 찾을 수 없습니다.');
  if (!force) {
    const have = await existingArt(banner);
    if (have) return have;
  }
  const world = await db.worlds.get(banner.worldId);
  const cast = await db.characters.where('worldId').equals(banner.worldId).toArray();
  const { prompt, negativePrompt, characters } = buildBannerArtPrompt(world, bannerCharacters(banner, cast), profile.gen);

  let result;
  try {
    result = await paintQueued(profile, { prompt, negativePrompt, characters, ...BANNER_SIZE, signal }, priority);
  } catch (e) {
    throw toImageError(profile.provider, e, profile.useRelay);
  }
  const blob = await toWebp(result.blob);

  return db.transaction('rw', db.banners, db.assets, async () => {
    const cur = await db.banners.get(bannerId);
    if (!cur) throw new Error('그리는 동안 배너가 지워졌습니다.');
    if (!force) {
      const have = await existingArt(cur);
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
    if (cur.artId && cur.artId !== asset.id) await db.assets.delete(cur.artId);
    await db.banners.put({ ...cur, artId: asset.id });
    return asset.id;
  });
}
