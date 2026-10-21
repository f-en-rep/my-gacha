import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import type { Character, ImageProfile, World } from '../types';

vi.mock('../gen/image', () => ({
  paintQueued: vi.fn(),
  toWebp: vi.fn(async (b: Blob) => new Blob([await b.arrayBuffer()], { type: 'image/webp' })),
  toImageError: vi.fn((_provider: string, e: unknown) => new Error('NovelAI: ' + (e as Error).message)),
}));

import { paintQueued } from '../gen/image';
import { buildPortraitPrompt, joinTags, paintPortrait, PORTRAIT_FRAMING_TAGS } from './portraits';

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

const character: Character = {
  id: 'c1',
  worldId: 'w1',
  name: '아린',
  rarity: 6,
  tags: { position: '원거리', role: ['딜러'], element: '불', trait: ['엘리트'] },
  appearance: '',
  imageTags: '1girl, red hair, Solo',
  personality: '',
  background: '',
  quotes: [],
  detail: 'full',
  createdAt: T,
  updatedAt: T,
};

function fakeResult(seed = 42) {
  return {
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    mime: 'image/png',
    width: 832,
    height: 1216,
    seed,
    prompt: 'P',
    negativePrompt: 'N',
  };
}

beforeEach(async () => {
  paint.mockReset();
  await Promise.all([db.characters.clear(), db.worlds.clear(), db.assets.clear(), db.profiles.clear(), db.settings.clear()]);
  await db.worlds.put(world);
  await db.characters.put(character);
  await db.profiles.put(profile);
  await db.settings.put({ id: 'app', routing: { image: 'p-nai' }, autoPaintLowRarity: false });
});

describe('prompt', () => {
  it('공통 = 화풍 + 구도, 캐릭터 태그는 캐릭터 슬롯으로', () => {
    const { prompt, negativePrompt, characters } = buildPortraitPrompt(world, character);
    expect(prompt).toBe(`masterpiece, best quality, ${PORTRAIT_FRAMING_TAGS}`);
    expect(characters).toEqual([{ prompt: '1girl, red hair, Solo', negative: undefined }]);
    expect(negativePrompt.startsWith('lowres')).toBe(true);
    expect(negativePrompt.endsWith('nsfw')).toBe(true);
    expect(joinTags(' a ,, b', 'A, c')).toBe('a, b, c');
  });

  it('연결의 메인·네거티브 프롬프트와 캐릭터 네거티브를 쓴다', () => {
    const r = buildPortraitPrompt(world, { ...character, imageNegative: 'glasses' }, { positive: 'very aesthetic', negative: 'bad hands' });
    expect(r.prompt.startsWith('very aesthetic, masterpiece')).toBe(true);
    expect(r.negativePrompt).toBe('bad hands, nsfw');
    expect(r.characters[0]).toEqual({ prompt: '1girl, red hair, Solo', negative: 'glasses' });
  });
});

describe('paintPortrait', () => {
  it('그림 연결이 없으면 undefined', async () => {
    await db.settings.put({ id: 'app', routing: {}, autoPaintLowRarity: false });
    expect(await paintPortrait('c1')).toBeUndefined();
    expect(paint).not.toHaveBeenCalled();
  });

  it('그려서 Asset 저장 + portraitId 채움', async () => {
    paint.mockResolvedValue(fakeResult());
    const id = await paintPortrait('c1', { priority: 'foreground' });
    expect(id).toBeDefined();
    expect(paint).toHaveBeenCalledTimes(1);
    const [p, req, prio] = paint.mock.calls[0]!;
    expect(p.id).toBe('p-nai');
    expect(req.width).toBe(832);
    expect(req.height).toBe(1216);
    expect(req.prompt).toContain('upper body');
    expect(prio).toBe('foreground');
    const asset = await db.assets.get(id!);
    expect(asset).toMatchObject({ worldId: 'w1', mime: 'image/webp', width: 832, height: 1216, seed: 42, provider: 'novelai', prompt: 'P' });
    expect((await db.characters.get('c1'))?.portraitId).toBe(id);
  });

  it('이미 있으면 다시 그리지 않음, force면 새로 그리고 옛 그림 삭제', async () => {
    paint.mockResolvedValue(fakeResult(1));
    const first = await paintPortrait('c1');
    expect(await paintPortrait('c1')).toBe(first);
    expect(paint).toHaveBeenCalledTimes(1);

    paint.mockResolvedValue(fakeResult(2));
    const second = await paintPortrait('c1', { force: true });
    expect(second).not.toBe(first);
    expect(paint).toHaveBeenCalledTimes(2);
    expect(await db.assets.get(first!)).toBeUndefined();
    expect((await db.assets.get(second!))?.seed).toBe(2);
    expect(await db.assets.count()).toBe(1);
  });

  it('같은 캐릭터 동시 호출은 한 번만 그림', async () => {
    let resolve!: (v: ReturnType<typeof fakeResult>) => void;
    paint.mockReturnValue(new Promise((r) => (resolve = r)));
    const a = paintPortrait('c1');
    const b = paintPortrait('c1', { force: true });
    await new Promise((r) => setTimeout(r, 20));
    resolve(fakeResult());
    const [ia, ib] = await Promise.all([a, b]);
    expect(ia).toBe(ib);
    expect(paint).toHaveBeenCalledTimes(1);
  });

  it('실패하면 한국어 오류, 캐릭터는 그대로', async () => {
    paint.mockRejectedValue(new Error('boom'));
    await expect(paintPortrait('c1')).rejects.toThrow('NovelAI: boom');
    expect((await db.characters.get('c1'))?.portraitId).toBeUndefined();
    // 실패 뒤에는 다시 시도할 수 있다
    paint.mockResolvedValue(fakeResult());
    expect(await paintPortrait('c1')).toBeDefined();
  });

  it('없는 캐릭터', async () => {
    await expect(paintPortrait('nope')).rejects.toThrow('캐릭터를 찾을 수 없습니다');
  });
});
