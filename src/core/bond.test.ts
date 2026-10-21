import { describe, expect, it } from 'vitest';
import {
  BOND_DAILY_CAP,
  BOND_REWARDS,
  BOND_THRESHOLDS,
  BOND_TITLES,
  addChatPoints,
  bondLevel,
  bondStance,
  bondTitle,
  claimableLevels,
} from './bond';

describe('bondLevel', () => {
  it('maps points to levels by threshold', () => {
    expect(bondLevel(0)).toEqual({ level: 1, toNext: 15, floor: 0, ceil: 15 });
    expect(bondLevel(14).level).toBe(1);
    expect(bondLevel(15)).toEqual({ level: 2, toNext: 25, floor: 15, ceil: 40 });
    expect(bondLevel(139).level).toBe(4);
    expect(bondLevel(140).level).toBe(5);
    expect(bondLevel(799)).toEqual({ level: 9, toNext: 1, floor: 600, ceil: 800 });
  });
  it('caps at level 10', () => {
    expect(bondLevel(800)).toEqual({ level: 10, toNext: 0, floor: 800, ceil: 800 });
    expect(bondLevel(5000)).toEqual({ level: 10, toNext: 0, floor: 800, ceil: 800 });
  });
  it('handles bad input', () => {
    expect(bondLevel(-5).level).toBe(1);
    expect(bondLevel(Number.NaN).level).toBe(1);
  });
  it('has 10 thresholds, rewards for 2..10 and titles for 1..10', () => {
    expect(BOND_THRESHOLDS).toHaveLength(10);
    expect(Object.keys(BOND_REWARDS).map(Number)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(BOND_REWARDS[4]).toBe(300);
    expect(BOND_REWARDS[5]).toBe(600);
    expect(BOND_REWARDS[10]).toBe(1200);
    expect(BOND_TITLES[1]).toBe('처음 만난 사이');
    expect(BOND_TITLES[10]).toBe('둘도 없는 사이');
    expect(bondTitle(99)).toBe('둘도 없는 사이');
  });
});

describe('bondStance', () => {
  it('changes by band', () => {
    expect(bondStance(1)).toMatch(/just met/);
    expect(bondStance(2)).toBe(bondStance(3));
    expect(bondStance(3)).not.toBe(bondStance(4));
    expect(bondStance(10)).toMatch(/irreplaceable/);
  });
});

describe('addChatPoints', () => {
  it('starts a new bond', () => {
    const r = addChatPoints(undefined, '2026-10-21');
    expect(r).toEqual({ bond: { points: 3, claimed: [], today: { day: '2026-10-21', points: 3 } }, gained: 3 });
  });
  it('applies the daily cap and resets on a new day', () => {
    let b = addChatPoints(undefined, 'd1').bond;
    for (let i = 0; i < 20; i++) b = addChatPoints(b, 'd1').bond;
    expect(b.points).toBe(BOND_DAILY_CAP);
    expect(b.today).toEqual({ day: 'd1', points: 30 });
    expect(addChatPoints(b, 'd1').gained).toBe(0);
    const next = addChatPoints(b, 'd2');
    expect(next.gained).toBe(3);
    expect(next.bond).toMatchObject({ points: 33, today: { day: 'd2', points: 3 } });
  });
  it('does not mutate the input', () => {
    const b = { points: 10, claimed: [2], today: { day: 'd1', points: 9 } };
    addChatPoints(b, 'd1');
    expect(b).toEqual({ points: 10, claimed: [2], today: { day: 'd1', points: 9 } });
  });
  it('gives a partial amount near the cap', () => {
    expect(addChatPoints({ points: 0, claimed: [], today: { day: 'd', points: 29 } }, 'd').gained).toBe(1);
  });
});

describe('claimableLevels', () => {
  it('lists reached levels >= 2 that are not claimed', () => {
    expect(claimableLevels(undefined)).toEqual([]);
    expect(claimableLevels({ points: 14, claimed: [] })).toEqual([]);
    expect(claimableLevels({ points: 80, claimed: [] })).toEqual([2, 3, 4]);
    expect(claimableLevels({ points: 80, claimed: [3] })).toEqual([2, 4]);
    expect(claimableLevels({ points: 9999, claimed: [2, 3, 4, 5, 6, 7, 8, 9, 10] })).toEqual([]);
  });
});
