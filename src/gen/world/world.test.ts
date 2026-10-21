import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import type { ChatMessage } from '../text';
import { DEFAULT_SETTINGS, db } from '../../db';
import { SCHEMA_VERSION, type TextProfile } from '../../types';

vi.mock('../text', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../text')>();
  return { ...actual, generateJson: vi.fn() };
});

import { generateJson } from '../text';
import { START_CAST, TOTAL_STEPS, createWorldDraft, generateWorld, type WorldInput } from './index';
import { characterListSchema, setupSchema } from './schema';
import { computeStats } from './stats';

const mockGen = vi.mocked(generateJson);

const INPUT: WorldInput = {
  name: '',
  language: 'ko',
  description: '부유섬 위의 마도 공학 도시',
  scenario: '플레이어는 새로 부임한 지휘관',
  directives: '밝고 모험적인 분위기',
};

const SETUP_REPLY = {
  name: '아스트라 연합',
  roles: ['딜러', '방어형', '치료', '지원', '군중제어', '소환'],
  elements: ['불', '물', '바람', '번개'],
  traits: ['견습', '정규', '베테랑', '엘리트'],
  currency: { pull: '성석', shop: '자격증' },
  artStyle: { positive: 'masterpiece, best quality, anime coloring, soft lighting', negative: 'lowres, bad anatomy' },
  standardBannerName: '상시 모집',
};

let nameCounter = 0;
function fakeCharacter(i: number) {
  const roles = SETUP_REPLY.roles;
  const n = ++nameCounter;
  return {
    name: `캐릭터${n}`,
    position: i % 2 === 0 ? '근거리' : '원거리',
    roles: [roles[n % roles.length]],
    element: SETUP_REPLY.elements[n % SETUP_REPLY.elements.length],
    appearance: `은발의 소녀 ${n}. 푸른 눈.`,
    imageTags: '1girl, silver hair, long hair, blue eyes, slender, white coat, black gloves',
    personality: '침착하다.',
    background: '오래된 가문 출신.',
    quotes: ['잘 부탁해.', '가자.', '끝이야.'],
  };
}

type Reply = (text: string) => unknown;
const defaultReply: Reply = (text) => {
  if (text.includes('[task: world-setup]')) return SETUP_REPLY;
  const m = /\[task: characters rarity=(\d) count=(\d+)\]/.exec(text);
  if (!m) throw new Error('unknown prompt');
  return { characters: Array.from({ length: Number(m[2]) }, (_, i) => fakeCharacter(i)) };
};

/** generateJson 흉내: 진짜 스키마로 검사해서 돌려준다 */
function install(reply: Reply = defaultReply, failOnCall?: number) {
  let calls = 0;
  mockGen.mockImplementation(async (_p: TextProfile, messages: ChatMessage[], schema: ZodType<unknown>) => {
    calls++;
    if (calls === failOnCall) throw new Error('boom');
    const text = messages.map((x) => x.content).join('\n');
    const r = schema.safeParse(reply(text));
    if (!r.success) throw new Error(`schema: ${JSON.stringify(r.error.issues)}`);
    return { value: r.data, raw: '', attempts: 1 } as never;
  });
}

const PROFILE: TextProfile = { id: 'p1', type: 'text', label: 't', apiKey: 'k', useRelay: false, provider: 'openai', model: 'gpt' };

async function resetDb() {
  await Promise.all(db.tables.map((t) => t.clear()));
}

beforeEach(async () => {
  await resetDb();
  nameCounter = 0;
  mockGen.mockReset();
  await db.profiles.put(PROFILE);
  await db.settings.put({ ...DEFAULT_SETTINGS, routing: { structured: 'p1' } });
});
afterEach(() => vi.restoreAllMocks());

describe('createWorldDraft', () => {
  it('stores a draft world without calling AI', async () => {
    const id = await createWorldDraft({ ...INPUT, name: '  내 세계 ', artStyle: 'watercolor, pastel' });
    const w = await db.worlds.get(id);
    expect(w).toMatchObject({ name: '내 세계', status: 'draft', schemaVersion: SCHEMA_VERSION, language: 'ko' });
    expect(w!.tags).toEqual({ position: [], role: [], element: [], trait: [] });
    expect(w!.art.positiveTags).toBe('watercolor, pastel');
    expect(w!.art.negativeTags).not.toBe('');
    expect(mockGen).not.toHaveBeenCalled();
  });
});

describe('generateWorld', () => {
  it('builds the whole world', async () => {
    install();
    const id = await createWorldDraft(INPUT);
    const progress: [string, number, number][] = [];
    await generateWorld(id, { onProgress: (s, d, t) => progress.push([s, d, t]) });

    const w = (await db.worlds.get(id))!;
    expect(w.status).toBe('ready');
    expect(w.name).toBe('아스트라 연합');
    expect(w.tags.position).toEqual(['근거리', '원거리']);
    expect(w.tags.trait).toEqual(['견습', '정규', '베테랑', '엘리트']);
    expect(w.currency).toEqual({ pull: '성석', shop: '자격증' });
    expect(w.art.positiveTags).toContain('masterpiece');
    expect(w.genProgress).toEqual({ stage: '완료', done: TOTAL_STEPS, total: TOTAL_STEPS });
    expect(progress[0]).toEqual(['세계 설정 만드는 중', 0, TOTAL_STEPS]);
    expect(progress.map((p) => p[0])).toContain('6★ 캐릭터 2/2');
    expect(progress.at(-1)).toEqual(['완료', TOTAL_STEPS, TOTAL_STEPS]);

    // 설정 1 + 6★ 2 + 5★ 3 + 4★ 묶음 + 3★ 묶음
    expect(mockGen).toHaveBeenCalledTimes(8);

    const cast = await db.characters.where('worldId').equals(id).toArray();
    expect(cast).toHaveLength(13);
    for (const r of [6, 5, 4, 3] as const) expect(cast.filter((c) => c.rarity === r)).toHaveLength(START_CAST[r]);
    expect(new Set(cast.map((c) => c.name)).size).toBe(13);
    for (const c of cast) {
      expect(c.detail).toBe(c.rarity >= 5 ? 'full' : 'light');
      expect(w.tags.position).toContain(c.tags.position);
      for (const r of c.tags.role) expect(w.tags.role).toContain(r);
      expect(w.tags.element).toContain(c.tags.element);
      expect(c.tags.trait).toEqual([w.tags.trait[c.rarity - 3]]);
      expect(c.stats).toBeDefined();
      if (c.tags.position === '근거리') {
        expect(c.stats!.range).toBe(1);
        expect([2, 3]).toContain(c.stats!.block);
      } else {
        expect([3, 4]).toContain(c.stats!.range);
        expect([0, 1]).toContain(c.stats!.block);
      }
      if (c.detail === 'light') expect(c.quotes.length).toBeLessThanOrEqual(2);
    }

    const banners = await db.banners.where('worldId').equals(id).toArray();
    expect(banners).toHaveLength(1);
    expect(banners[0]).toMatchObject({ kind: 'standard', name: '상시 모집' });
    expect(banners[0]!.startsAt).toBeUndefined();
    expect([...banners[0]!.featured6].sort()).toEqual(cast.filter((c) => c.rarity === 6).map((c) => c.id).sort());
    expect([...banners[0]!.featured5].sort()).toEqual(cast.filter((c) => c.rarity === 5).map((c) => c.id).sort());
  });

  it('includes cast so far in later prompts', async () => {
    install();
    const id = await createWorldDraft(INPUT);
    await generateWorld(id);
    const third = mockGen.mock.calls[2]![1].map((m) => m.content).join('\n');
    expect(third).toContain('캐릭터1 (6★');
    expect(third).toContain('부유섬 위의 마도 공학 도시');
    expect(third).toContain('딜러, 방어형');
  });

  it('keeps the user name and art style', async () => {
    install();
    const id = await createWorldDraft({ ...INPUT, name: '내 세계', artStyle: 'oil painting' });
    await generateWorld(id);
    const w = (await db.worlds.get(id))!;
    expect(w.name).toBe('내 세계');
    expect(w.art.positiveTags).toBe('oil painting');
    const setupPrompt = mockGen.mock.calls[0]![1].map((m) => m.content).join('\n');
    expect(setupPrompt).not.toContain('"artStyle"');
    expect(setupPrompt).not.toContain('"name": string');
  });

  it('resumes after a failure without duplicating', async () => {
    install(defaultReply, 3); // 두 번째 6★에서 실패
    const id = await createWorldDraft(INPUT);
    await expect(generateWorld(id)).rejects.toThrow('boom');

    let w = (await db.worlds.get(id))!;
    expect(w.status).toBe('generating');
    expect(w.genProgress?.error).toBe('boom');
    expect(w.genProgress?.stage).toBe('6★ 캐릭터 2/2');
    expect(await db.characters.count()).toBe(1);

    mockGen.mockReset();
    install();
    await generateWorld(id);
    expect(mockGen).toHaveBeenCalledTimes(6); // 6★ 1 + 5★ 3 + 묶음 2, 설정은 다시 안 함
    w = (await db.worlds.get(id))!;
    expect(w.status).toBe('ready');
    expect(w.genProgress?.error).toBeUndefined();
    const cast = await db.characters.toArray();
    expect(cast).toHaveLength(13);
    expect(new Set(cast.map((c) => c.name)).size).toBe(13);
    expect(await db.banners.count()).toBe(1);

    // 다 된 월드를 다시 불러도 아무것도 안 한다
    mockGen.mockReset();
    await generateWorld(id);
    expect(mockGen).not.toHaveBeenCalled();
    expect(await db.characters.count()).toBe(13);
  });

  it('stops when aborted', async () => {
    install();
    const id = await createWorldDraft(INPUT);
    const ac = new AbortController();
    const run = generateWorld(id, {
      signal: ac.signal,
      onProgress: (stage) => {
        if (stage === '5★ 캐릭터 1/3') ac.abort();
      },
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    const w = (await db.worlds.get(id))!;
    expect(w.status).toBe('generating');
    expect(w.genProgress?.error).toBe('요청이 취소되었습니다.');
    expect(await db.characters.where('rarity').equals(6).count()).toBe(2);
    expect(await db.characters.where('rarity').equals(5).count()).toBe(0);
  });

  it('fails clearly without a text connection', async () => {
    install();
    await db.settings.clear();
    const id = await createWorldDraft(INPUT);
    await expect(generateWorld(id)).rejects.toThrow(/글 연결이 없습니다/);
    const w = (await db.worlds.get(id))!;
    expect(w.status).toBe('generating');
    expect(w.genProgress?.error).toMatch(/글 연결이 없습니다/);
    expect(mockGen).not.toHaveBeenCalled();
  });
});

describe('normalization', () => {
  const catalog = { position: ['근거리', '원거리'], role: SETUP_REPLY.roles, element: SETUP_REPLY.elements, trait: SETUP_REPLY.traits };

  it('accepts sloppy character output', () => {
    const schema = characterListSchema({ catalog, count: 1, detail: 'full', existingNames: [] });
    const r = schema.safeParse({
      Character: {
        Name: ' 리아 ',
        rarity: '6★',
        Tags: { Position: 'Melee', ROLES: '딜러 / 치유', Element: ' 번  개 ' },
        Appearance: '붉은 머리.',
        image_tags: ['red hair', 'short hair', 'green eyes', '1girl', 'armor', 'red hair'],
        personality: '용감하다.',
        backstory: ['첫 문단.', '둘째 문단.'],
        quotes: '1. 가자!\n- 물러서지 마.',
        archetype: 'Striker',
      },
    });
    expect(r.success).toBe(true);
    const c = r.data![0]!;
    expect(c).toMatchObject({ name: '리아', position: '근거리', role: ['딜러', '치료'], element: '번개', archetype: 'striker' });
    expect(c.imageTags).toBe('1girl, red hair, short hair, green eyes, armor');
    expect(c.background).toBe('첫 문단.\n\n둘째 문단.');
    expect(c.quotes).toEqual(['가자!', '물러서지 마.']);
  });

  it('accepts a bare array and rejects unknown tags, Korean image tags and duplicate names', () => {
    const schema = characterListSchema({ catalog, count: 2, detail: 'light', existingNames: ['카이'] });
    const base = { position: '원거리', roles: ['지원'], element: '물', appearance: 'a', personality: 'b', background: 'c', quotes: ['q'] };
    const r = schema.safeParse([
      { ...base, name: '카이', imageTags: '1boy, black hair, red eyes, coat, scarf' },
      { ...base, name: '나리', roles: ['마법사'], element: '어둠', imageTags: '1girl, 은발, blue eyes, coat, scarf' },
    ]);
    expect(r.success).toBe(false);
    const msgs = r.error!.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    expect(msgs).toContain('characters.0.name');
    expect(msgs).toContain('characters.1.roles: Unknown role(s) "마법사"');
    expect(msgs).toContain('characters.1.element');
    expect(msgs).toContain('characters.1.imageTags');
  });

  it('requires the exact count', () => {
    const schema = characterListSchema({ catalog, count: 4, detail: 'light', existingNames: [] });
    expect(schema.safeParse({ characters: [] }).success).toBe(false);
  });

  it('accepts flat setup output and falls back for bad traits', () => {
    const schema = setupSchema({ language: 'ko', askName: false, askArt: true });
    const r = schema.safeParse({
      roles: '딜러, 방어형, 치료, 지원, 군중제어, 소환, 저격, 돌격, 특수',
      Elements: ['불', '물', '불', '바람', '땅'],
      traits: ['a', 'b'],
      pull_currency: '성석',
      shopCurrency: '자격증',
      art_style: 'masterpiece, best quality, anime coloring',
      bannerName: '상시',
    });
    expect(r.success).toBe(true);
    expect(r.data!.tags.role).toHaveLength(8);
    expect(r.data!.tags.element).toEqual(['불', '물', '바람', '땅']);
    expect(r.data!.tags.position).toEqual(['근거리', '원거리']);
    expect(r.data!.tags.trait).toEqual(['신입', '숙련', '베테랑', '엘리트']);
    expect(r.data!.art?.positiveTags).toBe('masterpiece, best quality, anime coloring');
    expect(r.data!.currency).toEqual({ pull: '성석', shop: '자격증' });
  });

  it('asks again when setup lists are too short', () => {
    const schema = setupSchema({ language: 'ko', askName: true, askArt: false });
    const r = schema.safeParse({ roles: ['딜러'], elements: ['불'], currency: { pull: 'x', shop: 'y' }, standardBannerName: 'z' });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['name', 'roles', 'elements']));
  });
});

describe('computeStats', () => {
  it('is deterministic and follows position rules', () => {
    expect(computeStats('abc', 6, 'tank', true)).toEqual(computeStats('abc', 6, 'tank', true));
    expect(computeStats('abc', 6, 'tank', true).block).toBe(3);
    const six = computeStats('x', 6, 'striker', false);
    const three = computeStats('x', 3, 'striker', false);
    expect(six.atk).toBeGreaterThan(three.atk);
    expect(six.range).toBeGreaterThanOrEqual(3);
  });
});
