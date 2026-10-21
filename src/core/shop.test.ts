import { describe, expect, it } from 'vitest';
import { char, makeSave } from './gacha/test-fixtures';
import {
  SHOP_PRICES,
  buyPullBundles,
  bundleCost,
  maxBundles,
  potentialCost,
  raisePotential,
  recruitCharacter,
  recruitCost,
} from './shop';
import type { Save } from '../types';

const NOW = '2026-10-21T00:00:00.000Z';

function frozen(save: Save): Save {
  return JSON.parse(JSON.stringify(save)) as Save;
}

describe('가격표', () => {
  it('정해진 값', () => {
    expect(SHOP_PRICES.bundle).toEqual({ cost: 10, pull: 300 });
    expect(SHOP_PRICES.potential).toEqual({ 6: 40, 5: 20, 4: 8, 3: 3 });
    expect(SHOP_PRICES.recruit).toEqual({ 6: 180, 5: 90, 4: 30, 3: 10 });
  });

  it('자유 모드면 전부 0', () => {
    const s = makeSave({ freeMode: true });
    expect(bundleCost(s, 5)).toBe(0);
    expect(potentialCost(s, 6)).toBe(0);
    expect(recruitCost(s, 6)).toBe(0);
    const p = makeSave();
    expect(bundleCost(p, 5)).toBe(50);
    expect(potentialCost(p, 4)).toBe(8);
    expect(recruitCost(p, 3)).toBe(10);
  });

  it('최대 묶음 수', () => {
    expect(maxBundles(makeSave({ wallet: { pull: 0, shop: 39 } }))).toBe(3);
    expect(maxBundles(makeSave({ wallet: { pull: 0, shop: 9 } }))).toBe(0);
    expect(maxBundles(makeSave({ freeMode: true, wallet: { pull: 0, shop: 0 } }))).toBe(999);
  });
});

describe('뽑기 재화 교환', () => {
  it('묶음 N개 = 상점 10N → 뽑기 300N, 입력은 그대로', () => {
    const s = makeSave({ wallet: { pull: 100, shop: 35 } });
    const before = frozen(s);
    const r = buyPullBundles(s, 3, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.save.wallet).toEqual({ pull: 1000, shop: 5 });
    expect(r.save.updatedAt).toBe(NOW);
    expect(s).toEqual(before);
  });

  it('부족하면 insufficient', () => {
    expect(buyPullBundles(makeSave({ wallet: { pull: 0, shop: 19 } }), 2, NOW)).toEqual({ ok: false, error: 'insufficient' });
  });

  it('잘못된 수량', () => {
    const s = makeSave({ wallet: { pull: 0, shop: 1000 } });
    for (const n of [0, -1, 1.5, Number.NaN, 1000]) expect(buyPullBundles(s, n, NOW)).toEqual({ ok: false, error: 'bad-amount' });
  });

  it('자유 모드는 공짜', () => {
    const r = buyPullBundles(makeSave({ freeMode: true, wallet: { pull: 0, shop: 0 } }), 2, NOW);
    expect(r.ok && r.save.wallet).toEqual({ pull: 600, shop: 0 });
  });
});

describe('잠재 올리기', () => {
  const six = char('a6', 6);
  const three = char('a3', 3);

  it('보유 캐릭터 잠재 +1, 값은 희귀도별', () => {
    const s = makeSave({
      wallet: { pull: 0, shop: 50 },
      owned: { a6: { characterId: 'a6', potential: 2, obtainedAt: 'x' }, a3: { characterId: 'a3', potential: 5, obtainedAt: 'y' } },
    });
    const before = frozen(s);
    const r = raisePotential(s, six, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.save.owned.a6).toEqual({ characterId: 'a6', potential: 3, obtainedAt: 'x' });
    expect(r.save.wallet.shop).toBe(10);
    expect(s).toEqual(before);
    const r2 = raisePotential(r.save, three, NOW);
    expect(r2.ok && r2.save.owned.a3!.potential).toBe(6);
    expect(r2.ok && r2.save.wallet.shop).toBe(7);
  });

  it('값 확인: 5★ 20, 4★ 8', () => {
    const owned = { a5: { characterId: 'a5', potential: 1, obtainedAt: '' }, a4: { characterId: 'a4', potential: 1, obtainedAt: '' } };
    const s = makeSave({ wallet: { pull: 0, shop: 28 }, owned });
    const r = raisePotential(s, char('a5', 5), NOW);
    expect(r.ok && r.save.wallet.shop).toBe(8);
    const r2 = r.ok ? raisePotential(r.save, char('a4', 4), NOW) : r;
    expect(r2.ok && r2.save.wallet.shop).toBe(0);
  });

  it('미보유면 not-owned', () => {
    expect(raisePotential(makeSave({ wallet: { pull: 0, shop: 999 } }), six, NOW)).toEqual({ ok: false, error: 'not-owned' });
  });

  it('최대면 max-potential (값보다 먼저)', () => {
    const s = makeSave({ wallet: { pull: 0, shop: 0 }, owned: { a6: { characterId: 'a6', potential: 6, obtainedAt: '' } } });
    expect(raisePotential(s, six, NOW)).toEqual({ ok: false, error: 'max-potential' });
  });

  it('부족하면 insufficient', () => {
    const s = makeSave({ wallet: { pull: 0, shop: 39 }, owned: { a6: { characterId: 'a6', potential: 1, obtainedAt: '' } } });
    expect(raisePotential(s, six, NOW)).toEqual({ ok: false, error: 'insufficient' });
  });

  it('자유 모드는 공짜', () => {
    const s = makeSave({ freeMode: true, wallet: { pull: 0, shop: 0 }, owned: { a6: { characterId: 'a6', potential: 1, obtainedAt: '' } } });
    const r = raisePotential(s, six, NOW);
    expect(r.ok && r.save.owned.a6!.potential).toBe(2);
  });
});

describe('캐릭터 영입', () => {
  it('미보유 캐릭터를 잠재 1로, 값은 희귀도별', () => {
    const s = makeSave({ wallet: { pull: 5, shop: 200 } });
    const before = frozen(s);
    const r = recruitCharacter(s, char('a6', 6), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.save.owned.a6).toEqual({ characterId: 'a6', potential: 1, obtainedAt: NOW });
    expect(r.save.wallet).toEqual({ pull: 5, shop: 20 });
    expect(s).toEqual(before);
    const r2 = recruitCharacter(r.save, char('a3', 3), NOW);
    expect(r2.ok && r2.save.wallet.shop).toBe(10);
  });

  it('5★ 90, 4★ 30', () => {
    const s = makeSave({ wallet: { pull: 0, shop: 120 } });
    const r = recruitCharacter(s, char('a5', 5), NOW);
    const r2 = r.ok ? recruitCharacter(r.save, char('a4', 4), NOW) : r;
    expect(r2.ok && r2.save.wallet.shop).toBe(0);
  });

  it('보유 중이면 already-owned', () => {
    const s = makeSave({ wallet: { pull: 0, shop: 999 }, owned: { a6: { characterId: 'a6', potential: 1, obtainedAt: '' } } });
    expect(recruitCharacter(s, char('a6', 6), NOW)).toEqual({ ok: false, error: 'already-owned' });
  });

  it('부족하면 insufficient', () => {
    expect(recruitCharacter(makeSave({ wallet: { pull: 0, shop: 179 } }), char('a6', 6), NOW)).toEqual({ ok: false, error: 'insufficient' });
  });

  it('자유 모드는 공짜', () => {
    const r = recruitCharacter(makeSave({ freeMode: true, wallet: { pull: 0, shop: 0 } }), char('a6', 6), NOW);
    expect(r.ok && r.save.owned.a6!.potential).toBe(1);
    expect(r.ok && r.save.wallet.shop).toBe(0);
  });
});
