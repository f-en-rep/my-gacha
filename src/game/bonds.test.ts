import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { newSave } from './store';
import { claimBondReward } from './bonds';

let saveId = '';

beforeEach(async () => {
  await db.saves.clear();
  const s = newSave('w1');
  s.wallet.pull = 100;
  s.bonds = { c1: { points: 80, claimed: [2] } };
  saveId = s.id;
  await db.saves.put(s);
});

describe('claimBondReward', () => {
  it('pays a reached, unclaimed level once', async () => {
    expect(await claimBondReward(saveId, 'c1', 4)).toBe(300);
    let s = (await db.saves.get(saveId))!;
    expect(s.wallet.pull).toBe(400);
    expect(s.bonds!.c1!.claimed).toEqual([2, 4]);
    expect(await claimBondReward(saveId, 'c1', 4)).toBe(0);
    s = (await db.saves.get(saveId))!;
    expect(s.wallet.pull).toBe(400);
  });
  it('refuses claimed, unreached, level 1 and unknown targets', async () => {
    expect(await claimBondReward(saveId, 'c1', 2)).toBe(0);
    expect(await claimBondReward(saveId, 'c1', 5)).toBe(0);
    expect(await claimBondReward(saveId, 'c1', 1)).toBe(0);
    expect(await claimBondReward(saveId, 'nobody', 2)).toBe(0);
    expect(await claimBondReward('no-save', 'c1', 3)).toBe(0);
    expect((await db.saves.get(saveId))!.wallet.pull).toBe(100);
  });
  it('handles concurrent claims of the same level once', async () => {
    const r = await Promise.all([claimBondReward(saveId, 'c1', 3), claimBondReward(saveId, 'c1', 3)]);
    expect(r.sort()).toEqual([0, 300]);
    expect((await db.saves.get(saveId))!.wallet.pull).toBe(400);
  });
  it('claims every open level when no level is given', async () => {
    expect(await claimBondReward(saveId, 'c1')).toBe(600);
    const s = (await db.saves.get(saveId))!;
    expect(s.wallet.pull).toBe(700);
    expect(s.bonds!.c1!.claimed).toEqual([2, 3, 4]);
    expect(await claimBondReward(saveId, 'c1')).toBe(0);
  });
});
