import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import type { ChatMessage } from '../text';
import { DEFAULT_SETTINGS, db } from '../../db';
import { SCHEMA_VERSION, type Character, type TextProfile, type World } from '../../types';

vi.mock('../text', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../text')>();
  return { ...actual, generateJson: vi.fn() };
});

import { generateJson } from '../text';
import { generateBannerMeta, generateCharacters } from './index';
import { bannerMetaSchema } from './schema';

const mockGen = vi.mocked(generateJson);
const T = '2026-01-01T00:00:00.000Z';
const ROLES = ['딜러', '방어형', '치료', '지원', '군중제어', '소환'];
const ELEMENTS = ['불', '물', '바람', '번개'];

const world: World = {
  id: 'w1',
  schemaVersion: SCHEMA_VERSION,
  name: '아스트라',
  language: 'ko',
  description: '부유섬 위의 마도 공학 도시',
  scenario: '',
  directives: '',
  tags: { position: ['근거리', '원거리'], role: ROLES, element: ELEMENTS, trait: ['신입', '숙련', '베테랑', '엘리트'] },
  currency: { pull: '성석', shop: '자격증' },
  art: { positiveTags: 'masterpiece', negativeTags: 'lowres' },
  status: 'ready',
  createdAt: T,
  updatedAt: T,
};

const existing: Character = {
  id: 'c0',
  worldId: 'w1',
  name: '리아',
  rarity: 6,
  tags: { position: '근거리', role: ['딜러'], element: '불', trait: ['엘리트'] },
  appearance: '붉은 머리의 검사.',
  imageTags: '1girl, red hair, sword',
  personality: '',
  background: '',
  quotes: [],
  detail: 'full',
  createdAt: T,
  updatedAt: T,
};

let n = 0;
function fakeCharacter(i: number) {
  n++;
  return {
    name: `새캐릭터${n}`,
    position: i % 2 ? '원거리' : '근거리',
    roles: [ROLES[n % ROLES.length]],
    element: ELEMENTS[n % ELEMENTS.length],
    appearance: '여름 축제 의상을 입은 소녀.',
    imageTags: '1girl, black hair, yukata, fan, blue eyes',
    personality: '밝다.',
    background: '축제의 주인공.',
    quotes: ['같이 가자!', '불꽃놀이다!', '셋'],
  };
}

function install(reply?: (text: string) => unknown) {
  mockGen.mockImplementation(async (_p: TextProfile, messages: ChatMessage[], schema: ZodType<unknown>) => {
    const text = messages.map((x) => x.content).join('\n');
    let r: unknown;
    if (reply) r = reply(text);
    else if (text.includes('[task: banner-meta]')) r = { name: '「한여름 불꽃」', description: '축제의 밤이 열립니다.' };
    else {
      const m = /\[task: characters rarity=(\d) count=(\d+)\]/.exec(text)!;
      r = { characters: Array.from({ length: Number(m[2]) }, (_, i) => fakeCharacter(i)) };
    }
    const parsed = schema.safeParse(r);
    if (!parsed.success) throw new Error(`schema: ${JSON.stringify(parsed.error.issues)}`);
    return { value: parsed.data, raw: '', attempts: 1 } as never;
  });
}

const PROFILE: TextProfile = { id: 'p1', type: 'text', label: 't', apiKey: 'k', useRelay: false, provider: 'openai', model: 'gpt' };

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  n = 0;
  mockGen.mockReset();
  await db.profiles.put(PROFILE);
  await db.settings.put({ ...DEFAULT_SETTINGS, routing: { structured: 'p1' } });
  await db.worlds.put(world);
  await db.characters.put(existing);
});

describe('generateCharacters', () => {
  it('adds 6★ one at a time with the theme and the growing cast', async () => {
    install();
    const progress: string[] = [];
    const ids = await generateCharacters('w1', { rarity: 6, count: 2, brief: '여름 축제 한정', onProgress: (s) => progress.push(s) });
    expect(ids).toHaveLength(2);
    expect(mockGen).toHaveBeenCalledTimes(2);
    const first = mockGen.mock.calls[0]![1].map((m) => m.content).join('\n');
    const second = mockGen.mock.calls[1]![1].map((m) => m.content).join('\n');
    expect(first).toContain('여름 축제 한정');
    expect(first).toContain('리아 (6★');
    expect(second).toContain('새캐릭터1 (6★');
    expect(progress).toEqual(['6★ 캐릭터 1/2', '6★ 캐릭터 2/2', '완료']);

    const chars = await db.characters.bulkGet(ids);
    for (const c of chars) {
      expect(c).toMatchObject({ worldId: 'w1', rarity: 6, detail: 'full', tags: { trait: ['엘리트'] } });
      expect(c!.stats).toBeDefined();
    }
    expect(await db.characters.count()).toBe(3);
    // 월드 상태는 그대로
    expect((await db.worlds.get('w1'))!.status).toBe('ready');
  });

  it('batches 4★ in one light call, without a theme block when no brief', async () => {
    install();
    const ids = await generateCharacters('w1', { rarity: 4, count: 3 });
    expect(ids).toHaveLength(3);
    expect(mockGen).toHaveBeenCalledTimes(1);
    const text = mockGen.mock.calls[0]![1].map((m) => m.content).join('\n');
    expect(text).toContain('[task: characters rarity=4 count=3]');
    expect(text).not.toContain('Theme of the new recruitment banner');
    const chars = await db.characters.bulkGet(ids);
    expect(chars.every((c) => c!.detail === 'light' && c!.quotes.length <= 2)).toBe(true);
  });

  it('rejects names already in the cast (schema asks again)', async () => {
    install(() => ({ characters: [{ ...fakeCharacter(0), name: '리아' }] }));
    await expect(generateCharacters('w1', { rarity: 5, count: 1 })).rejects.toThrow(/already used/);
    expect(await db.characters.count()).toBe(1);
  });

  it('keeps characters made before an abort', async () => {
    install();
    const ac = new AbortController();
    const run = generateCharacters('w1', {
      rarity: 5,
      count: 3,
      signal: ac.signal,
      onProgress: (s) => {
        if (s === '5★ 캐릭터 2/3') ac.abort();
      },
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(await db.characters.where('rarity').equals(5).count()).toBe(1);
  });

  it('needs a ready world and a text connection', async () => {
    install();
    expect(await generateCharacters('w1', { rarity: 6, count: 0 })).toEqual([]);
    await db.worlds.update('w1', { status: 'generating' });
    await expect(generateCharacters('w1', { rarity: 6, count: 1 })).rejects.toThrow(/준비되지 않았습니다/);
    await db.worlds.update('w1', { status: 'ready' });
    await db.settings.clear();
    await expect(generateCharacters('w1', { rarity: 6, count: 1 })).rejects.toThrow(/글 연결이 없습니다/);
    expect(mockGen).not.toHaveBeenCalled();
  });
});

describe('generateBannerMeta', () => {
  it('returns a cleaned name and description from one call', async () => {
    install();
    const meta = await generateBannerMeta('w1', { brief: '여름 축제', featuredNames: ['리아'], kind: 'limited' });
    expect(meta).toEqual({ name: '한여름 불꽃', description: '축제의 밤이 열립니다.' });
    expect(mockGen).toHaveBeenCalledTimes(1);
    const text = mockGen.mock.calls[0]![1].map((m) => m.content).join('\n');
    expect(text).toContain('[task: banner-meta]');
    expect(text).toContain('Korean');
    expect(text).toContain('리아');
    expect(text).toContain('여름 축제');
    expect(text).toContain('limited-time');
  });

  it('schema is lenient about keys and requires a name', () => {
    const s = bannerMetaSchema();
    expect(s.safeParse({ banner: { title: '검은 기사단', summary: '돌아왔다.' } }).data).toEqual({ name: '검은 기사단', description: '돌아왔다.' });
    expect(s.safeParse({ title: 'x' }).data).toEqual({ name: 'x', description: '' });
    expect(s.safeParse({ description: 'y' }).success).toBe(false);
    expect(s.safeParse('nope').success).toBe(false);
  });
});
