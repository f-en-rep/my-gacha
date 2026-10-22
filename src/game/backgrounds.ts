// 장소 배경 그리기. 그림 연결이 없으면 아무것도 하지 않는다.
//
// - 초상화(portraits.ts)와 같은 연결·큐(paintQueued)를 쓰고, 가로 그림으로 그린다
// - 프롬프트 = 연결의 메인 프롬프트 + 월드 화풍 + 장소 태그 + 배경 구도 태그 (항상 영어, 인물 없음)
// - 캐릭터 슬롯 없음
// - 같은 장소를 동시에 두 번 그리지 않는다 (inFlight)
// - 실패하면 알림 (취소는 빼고). 배경은 읽는 중에 바로 보이므로 완료 알림은 없다
import { db } from '../db';
import { newId, now } from '../core/id';
import { paintQueued, toImageError, toWebp } from '../gen/image';
import { DEFAULT_NEGATIVE_TAGS, getImageProfile, joinTags } from './portraits';
import { noticeFailure, resolveNotice } from './notices';
import type { Asset, Id, ImageGenSettings, ImageProfile, Location, World } from '../types';

export interface BackgroundPaintOptions {
  priority?: 'foreground' | 'background';
  /** 이미 있어도 다시 그리기 */
  force?: boolean;
  signal?: AbortSignal;
}

/** 배경 구도 (상황 태그) */
export const BACKGROUND_SCENE_TAGS = 'scenery, no humans, wide shot, detailed background';

/** 배경에 사람이 나오지 않게 네거티브에 더하는 태그 */
export const BACKGROUND_NEGATIVE_TAGS = 'people, character, 1girl, 1boy';

/** 연결이 세로(또는 정사각) 크기일 때 쓰는 가로 크기 */
export const LANDSCAPE_SIZE = { width: 1216, height: 832 } as const;

export interface BackgroundPrompt {
  prompt: string;
  negativePrompt: string;
}

export function buildBackgroundPrompt(world: Pick<World, 'art'> | undefined, location: Pick<Location, 'imageTags'>, gen?: ImageGenSettings): BackgroundPrompt {
  return {
    prompt: joinTags(gen?.positive, world?.art.positiveTags, location.imageTags, BACKGROUND_SCENE_TAGS),
    negativePrompt: joinTags(gen?.negative?.trim() ? gen.negative : DEFAULT_NEGATIVE_TAGS, world?.art.negativeTags, BACKGROUND_NEGATIVE_TAGS),
  };
}

/** 가로 크기: 연결이 이미 가로면 그대로, 아니면 1216×832 */
export function landscapeSize(profile: Pick<ImageProfile, 'width' | 'height'>): { width: number; height: number } {
  if (profile.width > 0 && profile.height > 0 && profile.width > profile.height) return { width: profile.width, height: profile.height };
  return { ...LANDSCAPE_SIZE };
}

const inFlight = new Map<Id, Promise<Id | undefined>>();

/** 지금 그리는 중인지 (같은 탭 안에서) */
export function isPaintingLocation(locationId: Id): boolean {
  return inFlight.has(locationId);
}

/** 장소 배경을 그려 Location.artId를 채운다 (가로 그림). 이미 있으면 그 id. 그림 연결이 없으면 undefined */
export function paintLocation(locationId: Id, opts: BackgroundPaintOptions = {}): Promise<Id | undefined> {
  const running = inFlight.get(locationId);
  if (running) return running;
  const key = `location-art:${locationId}`;
  const p = doPaint(locationId, opts)
    .then(
      async (id) => {
        if (id) await resolveNotice(key);
        return id;
      },
      async (e: unknown) => {
        const l = await db.locations.get(locationId).catch(() => undefined);
        await noticeFailure({ key, job: 'location-art', title: `「${l?.name ?? '장소'}」 배경을 그리지 못했어요`, link: '/story', worldId: l?.worldId }, e, opts.signal);
        throw e;
      },
    )
    .finally(() => inFlight.delete(locationId));
  inFlight.set(locationId, p);
  return p;
}

async function existingArt(l: Location): Promise<Id | undefined> {
  if (!l.artId) return undefined;
  return (await db.assets.get(l.artId)) ? l.artId : undefined;
}

async function doPaint(locationId: Id, opts: BackgroundPaintOptions): Promise<Id | undefined> {
  const { priority = 'background', force = false, signal } = opts;
  const profile = await getImageProfile();
  if (!profile) return undefined;

  const location = await db.locations.get(locationId);
  if (!location) throw new Error('장소를 찾을 수 없습니다.');
  if (!force) {
    const have = await existingArt(location);
    if (have) return have;
  }
  const world = await db.worlds.get(location.worldId);
  const { prompt, negativePrompt } = buildBackgroundPrompt(world, location, profile.gen);
  const { width, height } = landscapeSize(profile);

  let result;
  try {
    result = await paintQueued(profile, { prompt, negativePrompt, width, height, signal }, priority);
  } catch (e) {
    throw toImageError(profile.provider, e, profile.useRelay);
  }
  const blob = await toWebp(result.blob);

  return db.transaction('rw', db.locations, db.assets, async () => {
    const cur = await db.locations.get(locationId);
    if (!cur) throw new Error('그리는 동안 장소가 지워졌습니다.');
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
    await db.locations.put({ ...cur, artId: asset.id });
    return asset.id;
  });
}
