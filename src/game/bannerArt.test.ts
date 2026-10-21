import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import type { Banner, Character, ImageProfile, World } from '../types';

vi.mock('../gen/image', () => ({
  paintQueued: vi.fn(),
  toWebp: vi.fn(async (b: Blob) => new Blob([await b.arrayBuffer()], { type: 'image/webp' })),
  toImageError: vi.fn((_provider: string, e: unknown) => new Error('NovelAI: ' + (e as Error).message)),
}));

import { paintQueued } from '../gen/image';
import { BANNER_FRAMING_TAGS, bannerCharacters, buildBannerArtPrompt, countTags, paintBannerArt, subjectOf } from './bannerArt';

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
};

const world = {
  id: 'w1',
  schemaVersion: 1,
  name: '테스트 월드',
  language: 'ko',
  description: '',
  scenario: '',
  directives: '',
  tags: { position: [], role: [], element: [], trait: [] },
  currency: { pull: '성석', shop: '자격증' },
  art: { positiveTags: 'masterpiece, best quality', negativeTags: 'nsfw' },
  status: 'ready',
  createdAt: T,
  updatedAt: T,
} satisfies World;

function char(id: string, rarity: 5 | 6, imageTags: string, imageNegative?: string): Character {
  return {
    id,
    worldId: 'w1',
    name: id,
    rarity,
    tags: { position: '원거리', role: ['딜러'], element: '불', trait: [] },
    appearance: '',
    imageTags,
    imageNegative,
    personality: '',
    background: '',
    quotes: [],
    detail: 'full',
    createdAt: T,
    updatedAt: T,
  };
}

const cast = [char('a6', 6, '1girl, solo, red hair', 'glasses'), char('b6', 6, '1boy, black hair'), char('c5', 5, '1girl, blue hair'), char('d5', 5, '1other, robot')];

const banner: Banner = {
  id: 'b1',
  worldId: 'w1',
  kind: 'limited',
  name: '한정',
  featured6: ['b6', 'a6'],
  featured5: ['c5', 'd5'],
  createdAt: T,
};

function fakeResult(seed = 42) {
  return {
    blob: new Blob([new Uint8Array([1])], { type: 'image/png' }),
    mime: 'image/png',
    width: 1216,
    height: 832,
    seed,
    prompt: 'P',
    negativePrompt: 'N',
  };
}

beforeEach(async () => {
  paint.mockReset();
  await Promise.all(db.tables.map((t) => t.clear()));
  await db.worlds.put(world);
  await db.characters.bulkPut(cast);
  await db.banners.put(banner);
  await db.profiles.put(profile);
  await db.settings.put({
    id: 'app',
    routing: { image: 'p-nai' },
    autoPaintLowRarity: false,
  });
});

describe('prompt', () => {
  it('인원 태그', () => {
    expect(subjectOf('solo, 2girls, x')).toBe('girl');
    expect(subjectOf('1boy, x')).toBe('boy');
    expect(subjectOf('no humans')).toBe('other');
    expect(countTags([cast[0]!])).toBe('');
    expect(countTags([cast[0]!, cast[2]!])).toBe('2girls');
    expect(countTags([cast[1]!, cast[0]!, cast[3]!])).toBe('1girl, 1boy, 1other');
    expect(countTags(Array.from({ length: 6 }, () => cast[1]!))).toBe('multiple boys');
  });

  it('픽업 6★ 먼저, 5★, 최대 3명', () => {
    expect(bannerCharacters(banner, cast).map((c) => c.id)).toEqual(['b6', 'a6', 'c5']);
    expect(bannerCharacters({ featured6: ['zz'], featured5: ['d5'] }, cast).map((c) => c.id)).toEqual(['d5']);
  });

  it('공통 = 인원 + 화풍 + 배너 구도, 캐릭터는 슬롯으로 (여러 명이면 solo 제외)', () => {
    const r = buildBannerArtPrompt(world, bannerCharacters(banner, cast), {
      positive: 'very aesthetic',
      negative: '',
    });
    expect(r.prompt).toBe(`2girls, 1boy, very aesthetic, masterpiece, best quality, ${BANNER_FRAMING_TAGS}`);
    expect(r.characters).toEqual([
      { prompt: '1boy, black hair', negative: undefined },
      { prompt: '1girl, red hair', negative: 'glasses' },
      { prompt: '1girl, blue hair', negative: undefined },
    ]);
    expect(r.negativePrompt.endsWith('nsfw')).toBe(true);
    const one = buildBannerArtPrompt(world, [cast[0]!]);
    expect(one.prompt).toBe(`masterpiece, best quality, ${BANNER_FRAMING_TAGS}`);
    expect(one.characters[0]!.prompt).toBe('1girl, solo, red hair');
  });
});

describe('paintBannerArt', () => {
  it('그림 연결이 없으면 undefined', async () => {
    await db.settings.put({
      id: 'app',
      routing: {},
      autoPaintLowRarity: false,
    });
    expect(await paintBannerArt('b1')).toBeUndefined();
    expect(paint).not.toHaveBeenCalled();
  });

  it('가로로 그려서 저장하고 artId 채움', async () => {
    paint.mockResolvedValue(fakeResult());
    const id = await paintBannerArt('b1');
    const [, req, prio] = paint.mock.calls[0]!;
    expect(req).toMatchObject({ width: 1216, height: 832 });
    expect(req.prompt.startsWith('2girls, 1boy')).toBe(true);
    expect(req.characters).toHaveLength(3);
    expect(prio).toBe('foreground');
    expect(await db.assets.get(id!)).toMatchObject({
      worldId: 'w1',
      mime: 'image/webp',
      seed: 42,
    });
    expect((await db.banners.get('b1'))?.artId).toBe(id);
  });

  it('이미 있으면 그대로, force면 다시 그리고 옛 그림 삭제', async () => {
    paint.mockResolvedValue(fakeResult(1));
    const first = await paintBannerArt('b1');
    expect(await paintBannerArt('b1')).toBe(first);
    expect(paint).toHaveBeenCalledTimes(1);
    paint.mockResolvedValue(fakeResult(2));
    const second = await paintBannerArt('b1', { force: true });
    expect(second).not.toBe(first);
    expect(await db.assets.get(first!)).toBeUndefined();
    expect(await db.assets.count()).toBe(1);
  });

  it('동시 호출은 한 번만', async () => {
    let resolve!: (v: ReturnType<typeof fakeResult>) => void;
    paint.mockReturnValue(new Promise((r) => (resolve = r)));
    const a = paintBannerArt('b1');
    const b = paintBannerArt('b1', { force: true });
    await new Promise((r) => setTimeout(r, 20));
    resolve(fakeResult());
    expect(await a).toBe(await b);
    expect(paint).toHaveBeenCalledTimes(1);
  });

  it('실패와 없는 배너', async () => {
    paint.mockRejectedValue(new Error('boom'));
    await expect(paintBannerArt('b1')).rejects.toThrow('NovelAI: boom');
    expect((await db.banners.get('b1'))?.artId).toBeUndefined();
    await expect(paintBannerArt('nope')).rejects.toThrow('배너를 찾을 수 없습니다');
  });
});
