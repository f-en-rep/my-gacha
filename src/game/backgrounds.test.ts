import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import type { ImageProfile, Location, World } from '../types';

vi.mock('../gen/image', () => ({
  paintQueued: vi.fn(),
  toWebp: vi.fn(async (b: Blob) => new Blob([await b.arrayBuffer()], { type: 'image/webp' })),
  toImageError: vi.fn((_provider: string, e: unknown) => new Error('NovelAI: ' + (e as Error).message)),
}));

import { paintQueued } from '../gen/image';
import { BACKGROUND_SCENE_TAGS, buildBackgroundPrompt, landscapeSize, paintLocation } from './backgrounds';

const paint = vi.mocked(paintQueued);
const T = '2026-01-01T00:00:00.000Z';

const profile: ImageProfile = {
  id: 'p-nai',
  type: 'image',
  provider: 'novelai',
  label: 'NAI',
  apiKey: 'k',
  model: 'nai-diffusion-4-5-full',
  minIntervalMs: 10000,
  width: 832,
  height: 1216,
  useRelay: false,
  gen: { positive: 'very aesthetic' },
};

const world = {
  id: 'w1',
  schemaVersion: 1,
  name: 'W',
  language: 'ko',
  description: '',
  scenario: '',
  directives: '',
  tags: { position: [], role: [], element: [], trait: [] },
  currency: { pull: 'a', shop: 'b' },
  art: { positiveTags: 'masterpiece', negativeTags: 'nsfw' },
  status: 'ready',
  createdAt: T,
  updatedAt: T,
} satisfies World;

const location: Location = { id: 'l1', worldId: 'w1', name: '부두', description: '', imageTags: 'harbor, sunset', createdAt: T };

function fakeResult(seed = 7) {
  return { blob: new Blob([new Uint8Array([1])], { type: 'image/png' }), mime: 'image/png', width: 1216, height: 832, seed, prompt: 'P', negativePrompt: 'N' };
}

beforeEach(async () => {
  paint.mockReset();
  await Promise.all([db.locations.clear(), db.worlds.clear(), db.assets.clear(), db.profiles.clear(), db.settings.clear()]);
  await db.worlds.put(world);
  await db.locations.put(location);
  await db.profiles.put(profile);
  await db.settings.put({ id: 'app', routing: { image: 'p-nai' }, autoPaintLowRarity: false });
});

describe('background prompt', () => {
  it('메인 + 화풍 + 장소 + 배경 구도, 사람 네거티브', () => {
    const r = buildBackgroundPrompt(world, location, profile.gen);
    expect(r.prompt).toBe(`very aesthetic, masterpiece, harbor, sunset, ${BACKGROUND_SCENE_TAGS}`);
    expect(r.negativePrompt.startsWith('lowres')).toBe(true);
    expect(r.negativePrompt).toContain('nsfw');
    expect(r.negativePrompt.endsWith('people, character, 1girl, 1boy')).toBe(true);
    expect(buildBackgroundPrompt(world, location, { negative: 'bad' }).negativePrompt).toBe('bad, nsfw, people, character, 1girl, 1boy');
  });

  it('세로 연결이면 1216×832, 가로 연결은 그대로', () => {
    expect(landscapeSize({ width: 832, height: 1216 })).toEqual({ width: 1216, height: 832 });
    expect(landscapeSize({ width: 1024, height: 1024 })).toEqual({ width: 1216, height: 832 });
    expect(landscapeSize({ width: 1344, height: 768 })).toEqual({ width: 1344, height: 768 });
  });
});

describe('paintLocation', () => {
  it('그림 연결이 없으면 undefined', async () => {
    await db.settings.put({ id: 'app', routing: {}, autoPaintLowRarity: false });
    expect(await paintLocation('l1')).toBeUndefined();
    expect(paint).not.toHaveBeenCalled();
  });

  it('가로로 그려 저장 + artId, 캐릭터 슬롯 없음', async () => {
    paint.mockResolvedValue(fakeResult());
    const id = await paintLocation('l1', { priority: 'foreground' });
    const [, req, prio] = paint.mock.calls[0]!;
    expect(req.width).toBe(1216);
    expect(req.height).toBe(832);
    expect(req.prompt).toContain('no humans');
    expect(req.prompt).toContain('harbor');
    expect(req.characters).toBeUndefined();
    expect(prio).toBe('foreground');
    expect(await db.assets.get(id!)).toMatchObject({ worldId: 'w1', mime: 'image/webp', seed: 7 });
    expect((await db.locations.get('l1'))?.artId).toBe(id);
  });

  it('이미 있으면 그대로, force면 새로 그리고 옛 그림 삭제', async () => {
    paint.mockResolvedValue(fakeResult(1));
    const first = await paintLocation('l1');
    expect(await paintLocation('l1')).toBe(first);
    paint.mockResolvedValue(fakeResult(2));
    const second = await paintLocation('l1', { force: true });
    expect(second).not.toBe(first);
    expect(await db.assets.get(first!)).toBeUndefined();
    expect(await db.assets.count()).toBe(1);
  });

  it('동시 호출은 한 번만', async () => {
    let resolve!: (v: ReturnType<typeof fakeResult>) => void;
    paint.mockReturnValue(new Promise((r) => (resolve = r)));
    const a = paintLocation('l1');
    const b = paintLocation('l1');
    await new Promise((r) => setTimeout(r, 20));
    resolve(fakeResult());
    expect(await a).toBe(await b);
    expect(paint).toHaveBeenCalledTimes(1);
  });

  it('없는 장소', async () => {
    await expect(paintLocation('nope')).rejects.toThrow('장소를 찾을 수 없습니다');
  });
});
