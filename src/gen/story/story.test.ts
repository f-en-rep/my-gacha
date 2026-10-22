import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import type { ChatMessage } from '../text';
import { DEFAULT_SETTINGS, db } from '../../db';
import type { Chapter, Character, TextProfile, World } from '../../types';

vi.mock('../text', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../text')>();
  return { ...actual, generateJson: vi.fn() };
});

import { generateJson } from '../text';
import { BEATS_PER_CHAPTER, ensureBeat, finishChapter, planNextChapter, prefetchBeat, storySoFar } from './index';
import { beatSchema, planSchema, splitLong } from './schema';

const mockGen = vi.mocked(generateJson);
const T = '2026-01-01T00:00:00.000Z';

const STRUCT: TextProfile = { id: 'p1', type: 'text', label: 's', apiKey: 'k', useRelay: false, provider: 'openai', model: 'smart' };
const PROSE: TextProfile = { id: 'p2', type: 'text', label: 'p', apiKey: 'k', useRelay: false, provider: 'openai', model: 'cheap' };

const world: World = {
  id: 'w1',
  schemaVersion: 1,
  name: '아스트라',
  language: 'ko',
  description: '부유섬 위의 마도 공학 도시',
  scenario: '플레이어는 새로 부임한 지휘관',
  directives: '세 챕터마다 누군가 죽는다',
  tags: { position: ['근거리', '원거리'], role: ['딜러'], element: ['불'], trait: [] },
  currency: { pull: '성석', shop: '자격증' },
  art: { positiveTags: 'masterpiece', negativeTags: '' },
  status: 'ready',
  createdAt: T,
  updatedAt: T,
};

function char(id: string, name: string, rarity: 3 | 4 | 5 | 6): Character {
  return {
    id,
    worldId: 'w1',
    name,
    rarity,
    tags: { position: '근거리', role: ['딜러'], element: '불', trait: [] },
    appearance: `${name}의 외형. 은발.`,
    imageTags: '1girl',
    personality: `${name}는 침착하다.`,
    background: '',
    quotes: [`${name}의 대사 하나`, '둘', '셋'],
    detail: 'full',
    createdAt: T,
    updatedAt: T,
  };
}

const CAST = [char('c1', '아린', 6), char('c2', '세레나', 5), char('c3', '카이', 4)];

type Reply = (text: string, profile: TextProfile) => unknown;
let prompts: { text: string; profile: TextProfile }[] = [];

function install(reply: Reply) {
  mockGen.mockImplementation(async (profile: TextProfile, messages: ChatMessage[], schema: ZodType<unknown>) => {
    const text = messages.map((m) => m.content).join('\n');
    prompts.push({ text, profile });
    const r = schema.safeParse(reply(text, profile));
    if (!r.success) throw new Error(`schema: ${JSON.stringify(r.error.issues)}`);
    return { value: r.data, raw: '', attempts: 1 } as never;
  });
}

function planReply(overrides: Partial<{ title: string; nodes: unknown[] }> = {}) {
  return {
    title: '첫 부임',
    synopsis: '지휘관이 도착한다. 도시가 흔들린다. 아린이 나선다.',
    nodes:
      overrides.nodes ??
      Array.from({ length: BEATS_PER_CHAPTER }, (_, i) => ({
        title: `장면${i + 1}`,
        guide: `일이 벌어진다 ${i + 1}`,
        cast: i === 0 ? ['아린', '세레나 ', '모르는사람'] : i === 1 ? ['아린님', '카이'] : [],
        location: i === 0 ? { name: '부두', description: '바람 부는 부두', imageTags: 'harbor, 1girl, sunset, 바다' } : i === 1 ? '부두' : '옛 광장',
      })),
    ...(overrides.title ? { title: overrides.title } : {}),
  };
}

function beatReply(n = 20) {
  const segs: unknown[] = [{ kind: 'narration', text: '바람이 분다.' }];
  for (let i = 1; i < n; i++) {
    if (i % 3 === 0) segs.push({ type: 'dialogue', speaker: '아린', text: `대사 ${i}` });
    else if (i % 3 === 1) segs.push({ kind: 'thought', speaker: '세레나', text: `생각 ${i}` });
    else segs.push({ kind: 'line', speaker: '경비병', text: `경비 ${i}` });
  }
  segs.push({ kind: 'line', speaker: '', text: '   ' });
  return { segments: segs };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  mockGen.mockReset();
  prompts = [];
  await db.profiles.bulkPut([STRUCT, PROSE]);
  await db.settings.put({ ...DEFAULT_SETTINGS, routing: { structured: 'p1' } });
  await db.worlds.put(world);
  await db.characters.bulkPut(CAST);
  await db.locations.put({ id: 'loc-old', worldId: 'w1', name: '옛 광장', description: '무너진 광장', imageTags: 'ruins, plaza', createdAt: T });
});

async function makeChapter(index: number, extra: Partial<Chapter> = {}): Promise<Chapter> {
  const c: Chapter = {
    id: `ch${index}`,
    worldId: 'w1',
    index,
    title: `제목${index}`,
    synopsis: `줄거리${index}`,
    nodes: Array.from({ length: BEATS_PER_CHAPTER }, (_, i) => ({ title: `N${i}`, guide: `G${index}-${i}`, castIds: i === 0 ? ['c1', 'c2'] : [], locationId: 'loc-old' })),
    status: 'planned',
    createdAt: T,
    updatedAt: T,
    ...extra,
  };
  await db.chapters.put(c);
  return c;
}

describe('planNextChapter', () => {
  it('챕터와 새 장소를 만들고 캐스트 이름을 id로', async () => {
    install(() => planReply());
    const id = await planNextChapter('w1');
    const ch = await db.chapters.get(id);
    expect(ch).toMatchObject({ index: 1, status: 'planned', title: '첫 부임' });
    expect(ch!.nodes).toHaveLength(BEATS_PER_CHAPTER);
    expect(ch!.nodes[0]!.castIds).toEqual(['c1', 'c2']);
    expect(ch!.nodes[1]!.castIds).toEqual(['c1', 'c3']);
    expect(ch!.nodes[2]!.castIds).toEqual([]);
    expect(ch!.nodes[2]!.locationId).toBe('loc-old');

    const locs = await db.locations.where('worldId').equals('w1').toArray();
    expect(locs).toHaveLength(2);
    const dock = locs.find((l) => l.name === '부두')!;
    expect(dock.imageTags).toBe('harbor, sunset');
    expect(ch!.nodes[0]!.locationId).toBe(dock.id);
    expect(ch!.nodes[1]!.locationId).toBe(dock.id);

    expect(prompts[0]!.profile.id).toBe('p1');
    expect(prompts[0]!.text).toContain('chapter 1');
    expect(prompts[0]!.text).toContain('세 챕터마다 누군가 죽는다');
    expect(prompts[0]!.text).toContain('Korean');
  });

  it('앞 챕터 요약과 장부를 프롬프트에 넣고 다음 번호를 쓴다', async () => {
    for (let i = 1; i <= 5; i++) await makeChapter(i, { status: 'complete', summary: `요약${i}`, ledger: `장부${i}` });
    install(() => planReply());
    const id = await planNextChapter('w1');
    expect((await db.chapters.get(id))!.index).toBe(6);
    const text = prompts[0]!.text;
    expect(text).toContain('장부1');
    expect(text).not.toContain('요약1');
    for (const i of [2, 3, 4, 5]) expect(text).toContain(`요약${i}`);
    expect(text).toContain('chapter 6');
  });

  it('장면 수가 모자라거나 장소를 모르면 거절 (재시도 피드백)', () => {
    const schema = planSchema({ nodeCount: 6, castNames: ['아린'], locationNames: ['옛 광장'] });
    expect(schema.safeParse(planReply({ nodes: [{ title: 'a', guide: 'b', location: '옛 광장' }] })).success).toBe(false);
    const bad = planReply();
    (bad.nodes[3] as { location: unknown }).location = '어딘가 모르는 곳';
    const r = schema.safeParse(bad);
    expect(r.success).toBe(false);
    if (!r.success) expect(JSON.stringify(r.error.issues)).toContain('unknown location');
  });

  it('장면이 많으면 잘라서 받아 준다, 장면당 3명까지', () => {
    const schema = planSchema({ nodeCount: 2, castNames: ['아린', '세레나', '카이', '도윤'], locationNames: ['광장'] });
    const r = schema.safeParse({
      chapter: {
        Title: '제목',
        Synopsis: '줄거리',
        scenes: [
          { title: 'a', guide: 'g', characters: '아린, 세레나, 카이, 도윤', place: '광장' },
          { title: 'b', guide: 'g', cast: [], location: { name: '광장' } },
          { title: 'c', guide: 'g', cast: [], location: '광장' },
        ],
      },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.nodes).toHaveLength(2);
      expect(r.data.nodes[0]!.cast).toEqual(['아린', '세레나', '카이']);
      expect(r.data.nodes[1]!.location).toEqual({ kind: 'existing', name: '광장' });
    }
  });

  it('구조화 연결이 없으면 한국어 오류', async () => {
    await db.settings.put({ ...DEFAULT_SETTINGS, routing: {} });
    await expect(planNextChapter('w1')).rejects.toThrow('글 연결이 없습니다');
  });
});

describe('ensureBeat', () => {
  it('한 번 쓰고 저장, 다음엔 저장된 것', async () => {
    await makeChapter(1);
    install(() => beatReply());
    const b = await ensureBeat('ch1', 0);
    expect(b.segments.length).toBe(20);
    const again = await ensureBeat('ch1', 0);
    expect(again.id).toBe(b.id);
    expect(mockGen).toHaveBeenCalledTimes(1);
    expect(await db.beats.count()).toBe(1);
  });

  it('말하는 사람을 캐스트 id로, 모르는 사람은 이름만', async () => {
    await makeChapter(1);
    install(() => beatReply());
    const b = await ensureBeat('ch1', 0);
    expect(b.segments[0]).toEqual({ kind: 'narration', text: '바람이 분다.' });
    expect(b.segments[1]).toMatchObject({ kind: 'thought', speakerId: 'c2', text: '생각 1' });
    expect(b.segments[2]).toEqual({ kind: 'line', speakerName: '경비병', text: '경비 2' });
    expect(b.segments[3]).toMatchObject({ kind: 'line', speakerId: 'c1' });
    expect(b.segments.every((s) => s.text.trim())).toBe(true);
  });

  it('동시 호출과 미리 쓰기는 한 번만 쓴다', async () => {
    await makeChapter(1);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mockGen.mockImplementation(async (_p, _m, schema: ZodType<unknown>) => {
      await gate;
      return { value: schema.parse(beatReply()), raw: '', attempts: 1 } as never;
    });
    prefetchBeat('ch1', 1);
    await new Promise((r) => setTimeout(r, 20));
    const ctrl = new AbortController();
    const a = ensureBeat('ch1', 1, { priority: 'foreground', signal: ctrl.signal });
    const b = ensureBeat('ch1', 1);
    release();
    const [ba, bb] = await Promise.all([a, b]);
    expect(ba.id).toBe(bb.id);
    expect(mockGen).toHaveBeenCalledTimes(1);
    expect(await db.beats.count()).toBe(1);
  });

  it('기다리던 쪽이 취소해도 미리 쓰기는 계속된다', async () => {
    await makeChapter(1);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mockGen.mockImplementation(async (_p, _m, schema: ZodType<unknown>) => {
      await gate;
      return { value: schema.parse(beatReply()), raw: '', attempts: 1 } as never;
    });
    prefetchBeat('ch1', 2);
    await new Promise((r) => setTimeout(r, 20));
    const ctrl = new AbortController();
    const a = ensureBeat('ch1', 2, { signal: ctrl.signal });
    ctrl.abort();
    await expect(a).rejects.toBeDefined();
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(await db.beats.count()).toBe(1);
  });

  it('문장 연결을 먼저 쓰고, 이전 장면 꼬리와 다음 장면 방향을 넣는다', async () => {
    await db.settings.put({ ...DEFAULT_SETTINGS, routing: { structured: 'p1', prose: 'p2' } });
    await makeChapter(1, { status: 'complete', summary: '지난 요약', ledger: '지난 장부' });
    await makeChapter(2);
    install(() => beatReply());
    await ensureBeat('ch2', 0);
    const b1 = await ensureBeat('ch2', 1);
    expect(b1).toBeDefined();
    expect(prompts.every((p) => p.profile.id === 'p2')).toBe(true);
    const text = prompts[1]!.text;
    expect(text).toContain('지난 요약');
    expect(text).toContain('G2-2'); // 다음 장면 방향
    expect(text).toContain('아린: "대사'); // 이전 장면 꼬리
    expect(text).toContain('G2-0'); // 앞 장면 한 줄
  });

  it('없는 장면', async () => {
    await makeChapter(1);
    await expect(ensureBeat('ch1', 99)).rejects.toThrow('장면');
  });
});

describe('finishChapter', () => {
  it('요약·장부·complete', async () => {
    await makeChapter(1);
    install((text) => (text.includes('[task: story-beat') ? beatReply() : { summary: '이번 요약', ledger: '아린이 각성했다\n그리고' }));
    await ensureBeat('ch1', 0);
    await finishChapter('ch1');
    const ch = await db.chapters.get('ch1');
    expect(ch).toMatchObject({ status: 'complete', summary: '이번 요약', ledger: '아린이 각성했다 그리고' });
    expect(prompts[1]!.text).toContain('대사 3');
    // 이미 끝났으면 호출 없음
    await finishChapter('ch1');
    expect(mockGen).toHaveBeenCalledTimes(2);
    expect(await storySoFar('w1', 2)).toContain('이번 요약');
  });
});

describe('기록 (사건·인물·물건)', () => {
  const finishReply = (extra: object) => ({ summary: '요약', ledger: '장부', ...extra });

  it('챕터를 마치면 기록이 쌓이고, 캐스트는 인물로 넣지 않는다', async () => {
    await makeChapter(1, { title: '첫날' });
    install((text) =>
      text.includes('[task: story-beat')
        ? beatReply()
        : finishReply({
            events: [{ name: '결정의 균열', summary: '아린이 결정의 금을 발견했다.' }, '경보: 섬 전체에 경보가 울렸다', { name: '' }],
            people: [{ name: '등대지기 노인', summary: '섬 끝 등대를 지키는 노인' }, { name: '아린', summary: '캐스트' }, { name: '세레나 씨', summary: '캐스트' }, { name: '아린의 어머니', summary: '다른 사람' }],
            items: { '낡은 열쇠': '결정실 문을 여는 열쇠' },
          }),
    );
    await ensureBeat('ch1', 0);
    await finishChapter('ch1');
    expect(prompts[1]!.text).toContain('Cast members (the playable characters — never list them under "people"):\n아린, 세레나, 카이');
    const lore = await db.lore.where('worldId').equals('w1').toArray();
    const names = (k: string) => lore.filter((e) => e.kind === k).map((e) => e.name).sort();
    expect(names('event')).toEqual(['결정의 균열', '경보']);
    expect(names('person')).toEqual(['등대지기 노인', '아린의 어머니']);
    expect(names('item')).toEqual(['낡은 열쇠']);
    const crack = lore.find((e) => e.name === '결정의 균열')!;
    expect(crack).toMatchObject({ chapterId: 'ch1', chapterIndex: 1, source: 'story', castIds: ['c1'] });
  });

  it('같은 이름은 고쳐 쓰고, 직접 적은 기록은 덮어쓰지 않는다. 다음 계획·장면에 들어간다', async () => {
    await db.lore.bulkPut([
      { id: 'lo1', worldId: 'w1', kind: 'person', name: '등대지기 노인', summary: '옛 설명', chapterIndex: 1, source: 'story', createdAt: T, updatedAt: T },
      { id: 'lo2', worldId: 'w1', kind: 'item', name: '낡은 열쇠', summary: '내가 적은 설명', source: 'manual', createdAt: T, updatedAt: T },
    ]);
    await makeChapter(1, { status: 'complete', summary: 's1', ledger: 'l1' });
    await makeChapter(2);
    install((text) =>
      text.includes('[task: story-beat')
        ? beatReply()
        : finishReply({ people: [{ name: '등대지기  노인', summary: '사실은 전직 수비대장' }], items: [{ name: '낡은 열쇠!', summary: '덮어쓰면 안 됨' }] }),
    );
    await ensureBeat('ch2', 0);
    expect(prompts[0]!.text).toContain('Known people and items from earlier chapters (not cast members; keep them consistent and reuse the names exactly):\nPeople:\n- 등대지기 노인: 옛 설명\nItems:\n- 낡은 열쇠: 내가 적은 설명');
    await finishChapter('ch2');
    expect(prompts[1]!.text).toContain('Already recorded people and items:\nPeople:\n- 등대지기 노인');
    const lore = await db.lore.where('worldId').equals('w1').toArray();
    expect(lore).toHaveLength(2);
    expect(lore.find((e) => e.id === 'lo1')!.summary).toBe('사실은 전직 수비대장');
    expect(lore.find((e) => e.id === 'lo2')!.summary).toBe('내가 적은 설명');
  });

  it('기록·프로필이 없으면 프롬프트에 그 자리가 없다. 플레이 중인 세이브의 프로필은 들어간다', async () => {
    install((text) => (text.includes('[task: story-plan') ? planReply() : beatReply()));
    await planNextChapter('w1');
    expect(prompts[0]!.text).not.toContain('Known people');
    expect(prompts[0]!.text).not.toContain('The player character');
    await db.saves.put({ ...(await import('../../game/store')).newSave('w1'), id: 's1', playerName: '유리', player: { profile: '새 지휘관', imageTags: '1girl' } });
    await db.settings.put({ ...DEFAULT_SETTINGS, routing: { structured: 'p1' }, activeWorldId: 'w1', activeSaveId: 's1' });
    const id = (await db.chapters.toArray())[0]!.id;
    await ensureBeat(id, 0);
    expect(prompts[1]!.text).toContain('The player character (the protagonist):\nName: 유리\nProfile: 새 지휘관\n\n');
    expect(prompts[1]!.text).not.toContain('1girl, ');
  });
});

describe('알림', () => {
  it('뒤에서 쓰다 실패하면 남기고, 같은 실패는 한 줄로 합친다. 멈춘 것은 남기지 않는다', async () => {
    await makeChapter(1);
    install(() => {
      throw new Error('요청이 너무 많습니다 (429)');
    });
    await expect(ensureBeat('ch1', 0)).rejects.toThrow('429');
    await expect(ensureBeat('ch1', 0)).rejects.toThrow('429');
    let list = await db.notices.toArray();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'error', job: 'story-beat', count: 2, link: '/story/ch1', worldId: 'w1', detail: '요청이 너무 많습니다 (429)' });

    const ctrl = new AbortController();
    mockGen.mockImplementation(async (_p, _m, _s, opts) => {
      await new Promise((r) => setTimeout(r, 5));
      opts?.signal?.throwIfAborted();
      return { value: [], raw: '', attempts: 1 } as never;
    });
    const p = ensureBeat('ch1', 1, { signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    list = await db.notices.toArray();
    expect(list).toHaveLength(1);

    install((text) => (text.includes('[task: story-beat') ? beatReply() : { summary: 's', ledger: 'l' }));
    await ensureBeat('ch1', 0);
    await new Promise((r) => setTimeout(r, 5));
    expect((await db.notices.get(list[0]!.id))!.readAt).toBeTruthy();
  });

  it('챕터 정리 실패도 남는다', async () => {
    await makeChapter(1);
    install((text) => {
      if (text.includes('[task: story-beat')) return beatReply();
      throw new Error('정리 실패');
    });
    await ensureBeat('ch1', 0);
    await expect(finishChapter('ch1')).rejects.toThrow('정리 실패');
    expect(await db.notices.toArray()).toMatchObject([{ job: 'story-finish', title: '1장 챕터를 정리하지 못했어요 (요약·기록)' }]);
  });
});

describe('schema helpers', () => {
  it('긴 지문을 220자 이하로 나눈다', () => {
    const long = Array.from({ length: 30 }, (_, i) => `문장 번호 ${i}입니다.`).join(' ');
    const parts = splitLong(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 220)).toBe(true);
    expect(parts.join(' ')).toBe(long);
    const r = beatSchema().safeParse({ segments: [{ kind: 'narration', text: long }, ...beatReply(10).segments] });
    expect(r.success).toBe(true);
  });

  it('토막이 너무 적으면 거절', () => {
    expect(beatSchema().safeParse({ segments: [{ kind: 'narration', text: 'a' }] }).success).toBe(false);
    expect(beatSchema().safeParse({ nope: 1 }).success).toBe(false);
  });
});
