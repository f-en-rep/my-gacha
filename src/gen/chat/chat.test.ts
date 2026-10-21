import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../text';
import { DEFAULT_SETTINGS, db } from '../../db';
import { today } from '../../game/store';
import type { Character, ChatLine, Save, TextProfile, World } from '../../types';

vi.mock('../text', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../text')>();
  return { ...actual, chatComplete: vi.fn() };
});

import { chatComplete } from '../text';
import { BUSY_MESSAGE, NOT_OWNED_MESSAGE, cleanReply, historyMessages, isReplying, regenerateLast, retryLast, sendChat } from './index';

const mockChat = vi.mocked(chatComplete);
const T = '2026-01-01T00:00:00.000Z';

const STRUCT: TextProfile = { id: 'p1', type: 'text', label: 's', apiKey: 'k', useRelay: false, provider: 'openai', model: 'smart' };
const PROSE: TextProfile = { id: 'p2', type: 'text', label: 'p', apiKey: 'k', useRelay: false, provider: 'openai', model: 'cheap', temperature: 0.7 };

const world: World = {
  id: 'w1',
  schemaVersion: 1,
  name: '아스트라',
  language: 'ko',
  description: '부유섬 위의 마도 공학 도시',
  scenario: '플레이어는 새로 부임한 지휘관',
  directives: '아린은 절대 존댓말을 쓰지 않는다',
  tags: { position: ['근거리', '원거리'], role: ['딜러'], element: ['불'], trait: [] },
  currency: { pull: '성석', shop: '자격증' },
  art: { positiveTags: 'masterpiece', negativeTags: '' },
  status: 'ready',
  createdAt: T,
  updatedAt: T,
};

function char(id: string, name: string): Character {
  return {
    id,
    worldId: 'w1',
    name,
    rarity: 6,
    tags: { position: '근거리', role: ['딜러'], element: '불', trait: [] },
    appearance: `${name}의 외형. 은발.`,
    imageTags: '1girl',
    personality: `${name}는 침착하다.`,
    background: `${name}의 과거. 몰락한 기사 가문.`,
    quotes: [`${name}의 대표 대사`],
    detail: 'full',
    createdAt: T,
    updatedAt: T,
  };
}

const save: Save = {
  id: 's1',
  worldId: 'w1',
  name: '기본',
  wallet: { pull: 0, shop: 0 },
  owned: { c1: { characterId: 'c1', potential: 1, obtainedAt: T } },
  pity: {},
  banners: {},
  freeMode: false,
  rngState: 1,
  createdAt: T,
  updatedAt: T,
};

let calls: { messages: ChatMessage[]; profile: TextProfile; opts: unknown }[] = [];

function reply(text: string | ((n: number) => string)) {
  mockChat.mockImplementation(async (profile, messages, opts) => {
    calls.push({ messages, profile, opts });
    return { text: typeof text === 'string' ? text : text(calls.length), model: profile.model };
  });
}

const lines = (): Promise<ChatLine[]> => db.chatLines.where('[saveId+characterId]').equals(['s1', 'c1']).sortBy('id');
const bond = async () => (await db.saves.get('s1'))!.bonds?.c1;

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  mockChat.mockReset();
  calls = [];
  await db.profiles.bulkPut([STRUCT, PROSE]);
  await db.settings.put({ ...DEFAULT_SETTINGS, routing: { structured: 'p1', prose: 'p2' } });
  await db.worlds.put(world);
  await db.characters.bulkPut([char('c1', '아린'), char('c2', '세레나')]);
  await db.saves.put(save);
});

describe('sendChat', () => {
  it('stores both lines, adds bond points and uses the prose profile', async () => {
    reply('어서 와, 지휘관.');
    const line = await sendChat('s1', 'c1', '  안녕  ');
    expect(line).toMatchObject({ role: 'char', text: '어서 와, 지휘관.', saveId: 's1', characterId: 'c1' });
    expect(line.id).toBeTypeOf('number');
    const ls = await lines();
    expect(ls.map((l) => [l.role, l.text])).toEqual([
      ['user', '안녕'],
      ['char', '어서 와, 지휘관.'],
    ]);
    expect(await bond()).toEqual({ points: 3, claimed: [], today: { day: today(), points: 3 } });
    expect(calls[0]!.profile.id).toBe('p2');
    expect(calls[0]!.opts).toMatchObject({ maxTokens: 1024, temperature: 0.7 });
  });

  it('applies the daily cap', async () => {
    reply('응.');
    for (let i = 0; i < 12; i++) await sendChat('s1', 'c1', `말 ${i}`);
    expect((await bond())!.points).toBe(30);
    expect(await lines()).toHaveLength(24);
  });

  it('refuses unowned or foreign characters', async () => {
    reply('x');
    await expect(sendChat('s1', 'c2', '안녕')).rejects.toThrow(NOT_OWNED_MESSAGE);
    await expect(sendChat('s1', 'nope', '안녕')).rejects.toThrow(NOT_OWNED_MESSAGE);
    expect(await db.chatLines.count()).toBe(0);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('refuses empty text', async () => {
    await expect(sendChat('s1', 'c1', '   ')).rejects.toThrow('할 말을');
  });

  it('keeps the user line on failure, throws Korean, and retryLast completes it', async () => {
    mockChat.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(sendChat('s1', 'c1', '안녕')).rejects.toThrow(/네트워크 오류/);
    expect((await lines()).map((l) => l.role)).toEqual(['user']);
    expect(await bond()).toBeUndefined();
    expect(isReplying('c1')).toBe(false);

    reply('늦었네.');
    const line = await retryLast('s1', 'c1');
    expect(line.text).toBe('늦었네.');
    expect((await lines()).map((l) => l.role)).toEqual(['user', 'char']);
    expect((await bond())!.points).toBe(3);
    await expect(retryLast('s1', 'c1')).rejects.toThrow('답을 기다리는');
  });

  it('refuses a second send while one is in flight', async () => {
    let release!: () => void;
    mockChat.mockImplementation(
      (profile) =>
        new Promise((res) => {
          release = () => res({ text: '응', model: profile.model });
        }),
    );
    const first = sendChat('s1', 'c1', '하나');
    expect(isReplying('c1')).toBe(true);
    await expect(sendChat('s1', 'c1', '둘')).rejects.toThrow(BUSY_MESSAGE);
    await vi.waitFor(() => expect(mockChat).toHaveBeenCalled());
    release();
    await first;
    expect(isReplying('c1')).toBe(false);
    expect((await lines()).map((l) => l.text)).toEqual(['하나', '응']);
  });
});

describe('regenerateLast', () => {
  it('replaces the last reply without extra points', async () => {
    reply((n) => `답 ${n}`);
    await sendChat('s1', 'c1', '안녕');
    await sendChat('s1', 'c1', '뭐 해?');
    const before = (await bond())!.points;
    const line = await regenerateLast('s1', 'c1');
    expect(line.text).toBe('답 3');
    expect((await lines()).map((l) => l.text)).toEqual(['안녕', '답 1', '뭐 해?', '답 3']);
    expect((await bond())!.points).toBe(before);
    // history sent for the regeneration ends at the last user line
    const msgs = calls[2]!.messages;
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: '뭐 해?' });
    expect(msgs.some((m) => m.content === '답 2')).toBe(false);
  });

  it('keeps the old reply when regeneration fails', async () => {
    reply('첫 답');
    await sendChat('s1', 'c1', '안녕');
    mockChat.mockRejectedValueOnce(new Error('boom'));
    await expect(regenerateLast('s1', 'c1')).rejects.toThrow('boom');
    expect((await lines()).map((l) => l.text)).toEqual(['안녕', '첫 답']);
  });

  it('errors with nothing to regenerate', async () => {
    await expect(regenerateLast('s1', 'c1')).rejects.toThrow('다시 쓸 답이 없습니다');
  });
});

describe('prompt', () => {
  it('contains the sheet, stance, directives, player name, story and history', async () => {
    await db.saves.put({ ...save, playerName: '레온', bonds: { c1: { points: 150, claimed: [] } }, story: { ch1: { beat: 0, segment: 0, clearedAt: T } } });
    await db.chapters.bulkPut([
      { id: 'ch1', worldId: 'w1', index: 1, title: '첫 부임', synopsis: 's', summary: '지휘관이 도시에 도착했다.', nodes: [], status: 'done', createdAt: T, updatedAt: T } as never,
      { id: 'ch2', worldId: 'w1', index: 2, title: '안 읽은 장', synopsis: '스포일러', summary: '비밀 결말', nodes: [], status: 'done', createdAt: T, updatedAt: T } as never,
    ]);
    reply('응');
    await sendChat('s1', 'c1', '첫 마디');
    await sendChat('s1', 'c1', '두 번째');
    const msgs = calls[1]!.messages;
    const sys = msgs[0]!;
    expect(sys.role).toBe('system');
    for (const s of ['아린의 외형', '아린는 침착하다', '몰락한 기사 가문', '"아린의 대표 대사"', 'Role: 딜러', 'Element: 불', 'bond level 5/10', 'comfortable around the player', '"레온"', '절대 존댓말', '지휘관이 도시에 도착했다', 'Korean', 'never continue the conversation']) {
      expect(sys.content).toContain(s);
    }
    expect(sys.content).not.toContain('비밀 결말');
    expect(msgs.slice(1)).toEqual([
      { role: 'user', content: '첫 마디' },
      { role: 'assistant', content: '응' },
      { role: 'user', content: '두 번째' },
    ]);
  });

  it('uses a neutral "you" without a player name', async () => {
    reply('응');
    await sendChat('s1', 'c1', '안녕');
    const sys = calls[0]!.messages[0]!.content;
    expect(sys).toContain('"당신"');
    expect(sys).toContain('just met');
    expect(sys).not.toContain('RECENT EVENTS');
  });

  it('limits and normalises history', () => {
    const mk = (i: number, role: 'user' | 'char'): ChatLine => ({ saveId: 's1', characterId: 'c1', role, text: `${role}${i}`, at: T });
    const many = Array.from({ length: 50 }, (_, i) => mk(i, i % 2 ? 'char' : 'user'));
    const h = historyMessages(many);
    // last 40 lines start with user10
    expect(h).toHaveLength(40);
    expect(h[0]).toEqual({ role: 'user', content: 'user10' });
    const merged = historyMessages([mk(0, 'char'), mk(1, 'user'), mk(2, 'user')]);
    expect(merged).toEqual([{ role: 'user', content: 'user1\n\nuser2' }]);
  });
});

describe('cleanReply', () => {
  it('strips name prefix and wrapping quotes', () => {
    expect(cleanReply('아린: "어서 와."', '아린')).toBe('어서 와.');
    expect(cleanReply('**아린**: 응.', '아린')).toBe('응.');
    expect(cleanReply('“좋아.”', '아린')).toBe('좋아.');
    expect(cleanReply('"하나." (웃는다) "둘."', '아린')).toBe('"하나." (웃는다) "둘."');
  });
  it('cuts trailing player role-play', () => {
    expect(cleanReply('응, 좋아.\n\n레온: 고마워!\n아린: 천만에.', '아린', '레온')).toBe('응, 좋아.');
    expect(cleanReply('그래.\nUser: ok', '아린')).toBe('그래.');
    expect(cleanReply('그래.\n아린: 또 말하기', '아린')).toBe('그래.');
  });
  it('removes think blocks and extra blank lines', () => {
    expect(cleanReply('<think>hmm</think>\n안녕.\n\n\n\n잘 지냈어?', '아린')).toBe('안녕.\n\n잘 지냈어?');
  });
});

describe('isReplying', () => {
  it('accepts (characterId) and (saveId, characterId)', () => {
    expect(isReplying('c1')).toBe(false);
    expect(isReplying('s1', 'c1')).toBe(false);
  });
});
