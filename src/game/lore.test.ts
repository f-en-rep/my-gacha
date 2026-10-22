import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { deleteLore, formatKnownLore, isCastName, mergeLore, saveLore, sortLore } from './lore';
import { formatPlayer, savePlayer } from './player';
import { newSave } from './store';
import type { LoreEntry } from '../types';

const T = '2026-01-01T00:00:00.000Z';
const cast = [
  { id: 'c1', name: '아린' },
  { id: 'c2', name: 'Serena Vale' },
];
const entry = (over: Partial<LoreEntry>): LoreEntry => ({
  id: 'x',
  worldId: 'w1',
  kind: 'person',
  name: 'n',
  summary: 's',
  source: 'story',
  createdAt: T,
  updatedAt: T,
  ...over,
});

describe('캐스트 이름 거르기', () => {
  it('같은 이름, 호칭, 영어 성·이름 하나', () => {
    for (const n of ['아린', ' 아 린 ', '아린 씨', '아린님', 'serena', 'Serena Vale', 'Vale']) expect(isCastName(n, cast), n).toBe(true);
    for (const n of ['아린의 어머니', '아리아', '세레나', 'Serenade', '']) expect(isCastName(n, cast), n).toBe(false);
  });
});

describe('기록 합치기', () => {
  it('같은 종류·이름이면 고쳐 쓰고, 종류가 다르면 따로', () => {
    const have = [entry({ id: 'p1', name: '등대지기', summary: '옛' })];
    const out = mergeLore(
      have,
      [
        { kind: 'person', name: '등대 지기', summary: '새 설명, 아린의 스승' },
        { kind: 'item', name: '등대지기', summary: '물건' },
        { kind: 'person', name: '아린', summary: '캐스트' },
      ],
      { worldId: 'w1', chapterId: 'ch2', chapterIndex: 2, cast, at: T },
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'p1', summary: '새 설명, 아린의 스승', castIds: ['c1'] });
    expect(out[1]).toMatchObject({ kind: 'item', chapterIndex: 2, source: 'story' });
  });

  it('직접 적은 기록과 바뀐 게 없는 기록은 건드리지 않는다', () => {
    const have = [entry({ id: 'm', name: '열쇠', kind: 'item', source: 'manual' }), entry({ id: 's', name: '노인', summary: '같음' })];
    expect(
      mergeLore(
        have,
        [
          { kind: 'item', name: '열쇠', summary: '덮기' },
          { kind: 'person', name: '노인', summary: '같음' },
        ],
        { worldId: 'w1', cast },
      ),
    ).toEqual([]);
  });

  it('긴 글은 자르고, 최신 챕터 먼저', () => {
    const [e] = mergeLore([], [{ kind: 'event', name: 'a'.repeat(100), summary: 'b'.repeat(1000) }], { worldId: 'w1', cast });
    expect(e!.name.length).toBeLessThanOrEqual(60);
    expect(e!.summary.length).toBeLessThanOrEqual(400);
    const sorted = sortLore([entry({ id: '1', chapterIndex: 1 }), entry({ id: 'm' }), entry({ id: '3', chapterIndex: 3 })]);
    expect(sorted.map((x) => x.id)).toEqual(['m', '3', '1']);
  });

  it('프롬프트용: 인물·물건만, 개수 제한, 비면 빈 글', () => {
    expect(formatKnownLore([entry({ kind: 'event' })])).toBe('');
    const many = Array.from({ length: 30 }, (_, i) => entry({ id: `p${i}`, name: `사람${i}`, updatedAt: `2026-01-${String(i + 1).padStart(2, '0')}` }));
    const text = formatKnownLore([...many, entry({ kind: 'item', name: '열쇠', summary: '' })]);
    expect(text.split('\n').filter((l) => l.startsWith('- 사람'))).toHaveLength(20);
    expect(text).toContain('Items:\n- 열쇠');
  });
});

describe('저장', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('직접 적고 고치고 지운다. 고친 자동 기록은 직접 적은 것이 된다', async () => {
    const id = await saveLore('w1', 'item', { name: ' 열쇠 ', summary: ' 문을 연다 ' });
    expect(await db.lore.get(id)).toMatchObject({ name: '열쇠', summary: '문을 연다', source: 'manual', kind: 'item' });
    await db.lore.put(entry({ id: 'auto' }));
    await saveLore('w1', 'person', { name: '노인', summary: '고침' }, 'auto');
    expect((await db.lore.get('auto'))!.source).toBe('manual');
    await expect(saveLore('w1', 'item', { name: '  ', summary: '' })).rejects.toThrow('이름');
    await deleteLore(id);
    expect(await db.lore.get(id)).toBeUndefined();
  });

  it('내 프로필: 길이 검사, 빈 칸은 지운다, 이름도 함께', async () => {
    const s = { ...newSave('w1'), id: 's1', bonds: { c1: { points: 3, claimed: [] } } };
    await db.saves.put(s);
    await savePlayer('s1', { name: ' 유리 ', profile: '지휘관', appearance: ' ', imageTags: '1girl' });
    const got = (await db.saves.get('s1'))!;
    expect(got.playerName).toBe('유리');
    expect(got.player).toEqual({ profile: '지휘관', imageTags: '1girl' });
    expect(got.bonds).toEqual(s.bonds);
    expect(formatPlayer(got)).toBe('Name: 유리\nProfile: 지휘관');
    expect(formatPlayer(got, { name: false })).toBe('Profile: 지휘관');
    await savePlayer('s1', { name: '', profile: '', appearance: '', imageTags: '' });
    const empty = (await db.saves.get('s1'))!;
    expect(empty.player).toBeUndefined();
    expect(empty.playerName).toBeUndefined();
    await expect(savePlayer('s1', { name: 'a'.repeat(25), profile: '', appearance: '', imageTags: '' })).rejects.toThrow('24자');
  });
});
