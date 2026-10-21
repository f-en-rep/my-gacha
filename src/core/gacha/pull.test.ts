import { describe, expect, it } from 'vitest';
import type { Rarity, Save } from '../../types';
import { ARKNIGHTS_RULES, type GachaRules } from './rules';
import { bannerPool, pityKey, pull, resolveRarity, type PullInput } from './pull';
import { canExchangeSpark, exchangeSpark } from './spark';
import { char, makeBanner, makeCast, makeSave } from './test-fixtures';

const NOW = '2026-01-01T00:00:00.000Z';
const cast = makeCast();

/** 희귀도 하나만 나오게 고정한 규칙 (천장 가산 없음) */
function only(rarity: Rarity, over: Partial<GachaRules> = {}): GachaRules {
  const baseRates = { 6: 0, 5: 0, 4: 0, 3: 0 } as Record<Rarity, number>;
  baseRates[rarity] = 1;
  return { ...ARKNIGHTS_RULES, baseRates, pityStep: 0, ...over };
}

function run(over: Partial<PullInput> = {}) {
  const res = pull({
    save: makeSave(),
    banner: makeBanner(),
    cast,
    rules: ARKNIGHTS_RULES,
    count: 1,
    now: NOW,
    ...over,
  });
  if (!res.ok) throw new Error(res.error);
  return res;
}

describe('비용과 자유 모드', () => {
  it('1회 600, 10회 6000 차감', () => {
    expect(run({ save: makeSave({ wallet: { pull: 6000, shop: 0 } }), count: 10 }).save.wallet.pull).toBe(0);
    expect(run({ save: makeSave({ wallet: { pull: 600, shop: 0 } }) }).save.wallet.pull).toBe(0);
  });
  it('재화가 모자라면 에러 (throw 아님), Save 그대로', () => {
    const save = makeSave({ wallet: { pull: 5999, shop: 0 } });
    expect(pull({ save, banner: makeBanner(), cast, rules: ARKNIGHTS_RULES, count: 10, now: NOW })).toEqual({
      ok: false,
      error: 'insufficient-funds',
    });
  });
  it('자유 모드면 0원이어도 뽑히고 차감 없음', () => {
    const r = run({ save: makeSave({ wallet: { pull: 0, shop: 0 }, freeMode: true }), count: 10 });
    expect(r.save.wallet.pull).toBe(0);
    expect(r.results).toHaveLength(10);
  });
  it('풀이 비면 empty-pool', () => {
    expect(pull({ save: makeSave(), banner: makeBanner(), cast: [], rules: ARKNIGHTS_RULES, count: 1, now: NOW })).toEqual({
      ok: false,
      error: 'empty-pool',
    });
    const b = makeBanner({ pool: ['nobody'], featured6: [], featured5: [] });
    expect(pull({ save: makeSave(), banner: b, cast, rules: ARKNIGHTS_RULES, count: 1, now: NOW }).ok).toBe(false);
  });
});

describe('천장', () => {
  it('sinceSix 98이면 99번째는 무조건 6★, 이후 0으로 초기화', () => {
    for (let seed = 0; seed < 200; seed++) {
      const r = run({ save: makeSave({ rngState: seed, pity: { standard: { sinceSix: 98 } } }) });
      expect(r.results[0]!.rarity).toBe(6);
      expect(r.results[0]!.pityBefore).toBe(98);
      expect(r.save.pity.standard!.sinceSix).toBe(0);
    }
  });
  it('6★가 아니면 카운터 +1', () => {
    const r = run({ rules: only(3), count: 7 });
    expect(r.save.pity.standard!.sinceSix).toBe(7);
    expect(r.results.map((x) => x.pityBefore)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
  it('상시 배너끼리 공유, 한정 배너는 따로', () => {
    expect(pityKey(makeBanner(), ARKNIGHTS_RULES)).toBe('standard');
    const lim = makeBanner({ id: 'lim1', kind: 'limited' });
    expect(pityKey(lim, ARKNIGHTS_RULES)).toBe('lim1');

    const rules = only(3);
    const a = run({ rules, count: 20 });
    const b = run({ save: a.save, banner: makeBanner({ id: 'std2' }), rules, count: 5 });
    expect(b.results[0]!.pityBefore).toBe(20);
    expect(b.save.pity.standard!.sinceSix).toBe(25);

    const c = run({ save: b.save, banner: lim, rules, count: 3 });
    expect(c.results[0]!.pityBefore).toBe(0);
    expect(c.save.pity.lim1!.sinceSix).toBe(3);
    expect(c.save.pity.standard!.sinceSix).toBe(25);
    const lim2 = run({ save: c.save, banner: makeBanner({ id: 'lim2', kind: 'limited' }), rules });
    expect(lim2.results[0]!.pityBefore).toBe(0);
  });
});

describe('첫 10회 보장', () => {
  it('9번까지 5★ 이상이 없으면 10번째는 5★', () => {
    const r = run({ rules: only(3), count: 12 });
    const rar = r.results.map((x) => x.rarity);
    expect(rar.slice(0, 9).every((x) => x === 3)).toBe(true);
    expect(rar[9]).toBe(5);
    expect(rar.slice(10)).toEqual([3, 3]);
    expect(r.save.banners.std1).toEqual({ pulls: 12, firstTenSatisfied: true, sparkPoints: 0 });
  });
  it('1회씩 나눠 뽑아도 같다', () => {
    let save = makeSave();
    const rar: Rarity[] = [];
    for (let i = 0; i < 10; i++) {
      const r = run({ save, rules: only(3) });
      save = r.save;
      rar.push(r.results[0]!.rarity);
    }
    expect(rar[9]).toBe(5);
  });
  it('10번째가 6★면 그대로 6★', () => {
    const r = run({ rules: only(6), count: 10 });
    expect(r.results[9]!.rarity).toBe(6);
  });
  it('이미 5★ 이상이 나왔으면 보장 없음', () => {
    const save = makeSave({ banners: { std1: { pulls: 5, firstTenSatisfied: true, sparkPoints: 0 } } });
    const r = run({ save, rules: only(3), count: 5 });
    expect(r.results.every((x) => x.rarity === 3)).toBe(true);
  });
  it('배너마다 따로', () => {
    const a = run({ rules: only(3), count: 10 });
    const b = run({ save: a.save, banner: makeBanner({ id: 'std2' }), rules: only(3), count: 10 });
    expect(b.results[9]!.rarity).toBe(5);
  });
  it('첫 10회 안에 5★가 자연스럽게 나오면 satisfied', () => {
    const r = run({ rules: only(5), count: 1 });
    expect(r.save.banners.std1!.firstTenSatisfied).toBe(true);
  });
});

describe('픽업', () => {
  function featuredShare(kind: 'standard' | 'limited', rarity: 5 | 6) {
    const banner = makeBanner({ kind, id: kind === 'limited' ? 'lim' : 'std1' });
    const save = makeSave({ freeMode: true, banners: { [banner.id]: { pulls: 100, firstTenSatisfied: true, sparkPoints: 0 } } });
    const r = run({ save, banner, rules: only(rarity), count: 20000 });
    const counts: Record<string, number> = {};
    for (const x of r.results) counts[x.character.id] = (counts[x.character.id] ?? 0) + 1;
    const feat = r.results.filter((x) => x.featured).length / r.results.length;
    expect(r.results.every((x) => x.featured === (x.character.id === `a${rarity}`))).toBe(true);
    return { feat, counts };
  }
  it('상시 6★ 50%', () => {
    const { feat, counts } = featuredShare('standard', 6);
    expect(feat).toBeGreaterThan(0.48);
    expect(feat).toBeLessThan(0.52);
    // 비픽업 3명 균등 (각 약 1/6)
    for (const id of ['b6', 'c6', 'd6']) expect(counts[id]! / 20000).toBeCloseTo(1 / 6, 1);
  });
  it('한정 6★ 70%', () => {
    const { feat } = featuredShare('limited', 6);
    expect(feat).toBeGreaterThan(0.68);
    expect(feat).toBeLessThan(0.72);
  });
  it('5★ 50% (상시, 한정 모두)', () => {
    for (const k of ['standard', 'limited'] as const) {
      const { feat } = featuredShare(k, 5);
      expect(feat).toBeGreaterThan(0.48);
      expect(feat).toBeLessThan(0.52);
    }
  });
  it('픽업이 여럿이면 그 안에서 균등', () => {
    const banner = makeBanner({ featured6: ['a6', 'b6'] });
    const r = run({ save: makeSave({ freeMode: true }), banner, rules: only(6), count: 10000 });
    const a = r.results.filter((x) => x.character.id === 'a6').length / 10000;
    expect(a).toBeGreaterThan(0.23);
    expect(a).toBeLessThan(0.27);
  });
  it('비픽업이 없으면 항상 픽업, 픽업이 없으면 비픽업만', () => {
    const onlyFeat = [char('a6', 6), char('x3', 3)];
    const r1 = run({ cast: onlyFeat, rules: only(6), count: 50 });
    expect(r1.results.every((x) => x.character.id === 'a6' && x.featured)).toBe(true);
    const r2 = run({ banner: makeBanner({ featured6: [] }), rules: only(6), count: 50 });
    expect(r2.results.every((x) => x.character.id !== 'a6' || !x.featured)).toBe(true);
    expect(r2.results.some((x) => x.character.id === 'a6')).toBe(true);
  });
});

describe('빈 희귀도 대체', () => {
  it('아래 희귀도로 내려가고, 없으면 위로', () => {
    const pool = [char('x4', 4), char('y3', 3)];
    expect(resolveRarity(6, pool)).toBe(4);
    expect(resolveRarity(3, pool)).toBe(3);
    expect(resolveRarity(5, [char('z6', 6)])).toBe(6);
    expect(resolveRarity(5, [])).toBeNull();
  });
  it('6★가 없는 풀에서 6★를 굴리면 5★, 천장은 계속 쌓인다', () => {
    const noSix = cast.filter((c) => c.rarity !== 6);
    const r = run({ cast: noSix, rules: only(6), count: 3 });
    expect(r.results.every((x) => x.rarity === 5)).toBe(true);
    expect(r.save.pity.standard!.sinceSix).toBe(3);
  });
  it('banner.pool이 있으면 그 캐릭터 + 픽업만', () => {
    const b = makeBanner({ pool: ['b6', 'b3'], featured6: ['a6'], featured5: [] });
    expect(bannerPool(b, cast).map((c) => c.id).sort()).toEqual(['a6', 'b3', 'b6']);
  });
});

describe('중복', () => {
  it('새 캐릭터는 owned에 잠재 1로', () => {
    const r = run({ cast: [char('x3', 3)] });
    expect(r.results[0]).toMatchObject({ isNew: true, potential: 1, shopGained: 0 });
    expect(r.save.owned.x3).toEqual({ characterId: 'x3', potential: 1, obtainedAt: NOW });
  });
  it('잠재 +1, 6에서 멈추고 그 뒤로 상점 재화', () => {
    const rules = only(6, { featuredChance: ARKNIGHTS_RULES.featuredChance });
    const r = run({ cast: [char('x6', 6)], rules, count: 8 });
    expect(r.results.map((x) => x.potential)).toEqual([1, 2, 3, 4, 5, 6, 6, 6]);
    expect(r.results.map((x) => x.isNew)).toEqual([true, false, false, false, false, false, false, false]);
    expect(r.results.map((x) => x.shopGained)).toEqual([0, 0, 0, 0, 0, 0, 15, 15]);
    expect(r.save.wallet.shop).toBe(30);
    expect(r.save.owned.x6!.potential).toBe(6);
  });
  it('상점 재화는 희귀도별 규칙 값', () => {
    for (const [rar, amount] of [[5, 8], [4, 3], [3, 1]] as const) {
      const save = makeSave({ owned: { x: { characterId: 'x', potential: 6, obtainedAt: '' } } });
      const r = run({ save, cast: [char('x', rar)] });
      expect(r.results[0]!.shopGained).toBe(amount);
    }
  });
});

describe('한정 배너 교환', () => {
  const lim = makeBanner({ id: 'lim', kind: 'limited', featured6: ['a6'] });
  it('1회당 1포인트, 상시 배너는 0', () => {
    expect(run({ banner: lim, count: 10 }).save.banners.lim!.sparkPoints).toBe(10);
    expect(run({ count: 10 }).save.banners.std1!.sparkPoints).toBe(0);
  });
  it('300포인트로 픽업 6★ 교환', () => {
    const r = run({ save: makeSave({ freeMode: true }), banner: lim, rules: only(3), count: 300 });
    expect(canExchangeSpark(r.save, lim, ARKNIGHTS_RULES)).toBe(true);
    const ex = exchangeSpark({ save: r.save, banner: lim, cast, rules: ARKNIGHTS_RULES, characterId: 'a6', now: NOW });
    if (!ex.ok) throw new Error(ex.error);
    expect(ex.outcome).toMatchObject({ rarity: 6, featured: true, isNew: true, potential: 1 });
    expect(ex.save.banners.lim!.sparkPoints).toBe(0);
    expect(ex.save.owned.a6!.potential).toBe(1);
    expect(ex.save.pity).toEqual(r.save.pity);
    expect(canExchangeSpark(ex.save, lim, ARKNIGHTS_RULES)).toBe(false);
  });
  it('에러들', () => {
    const save = makeSave({ banners: { lim: { pulls: 300, firstTenSatisfied: true, sparkPoints: 299 } } });
    const base = { cast, rules: ARKNIGHTS_RULES, now: NOW };
    expect(exchangeSpark({ ...base, save, banner: lim, characterId: 'a6' })).toEqual({ ok: false, error: 'insufficient-points' });
    expect(exchangeSpark({ ...base, save, banner: lim, characterId: 'b6' })).toEqual({ ok: false, error: 'not-featured' });
    expect(exchangeSpark({ ...base, save, banner: makeBanner(), characterId: 'a6' })).toEqual({ ok: false, error: 'not-limited' });
  });
});

describe('순수성과 재현성', () => {
  it('같은 시드면 같은 결과', () => {
    const a = run({ count: 10 });
    const b = run({ count: 10 });
    expect(a).toEqual(b);
    const c = run({ save: makeSave({ rngState: 999 }), count: 10 });
    expect(c.results.map((x) => x.character.id)).not.toEqual(a.results.map((x) => x.character.id));
  });
  it('10연차 = 1회 10번', () => {
    const ten = run({ count: 10 });
    let save: Save = makeSave();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = run({ save });
      save = r.save;
      ids.push(r.results[0]!.character.id);
    }
    expect(ids).toEqual(ten.results.map((x) => x.character.id));
    expect(save).toEqual(ten.save);
  });
  it('입력을 바꾸지 않는다', () => {
    const save = makeSave({ owned: { a3: { characterId: 'a3', potential: 2, obtainedAt: '' } } });
    const banner = makeBanner();
    const snapshot = structuredClone({ save, banner, cast });
    const r = run({ save, banner, count: 10 });
    expect({ save, banner, cast }).toEqual(snapshot);
    expect(r.save.rngState).not.toBe(save.rngState);
  });
  it('기록(PullRecord)이 결과와 맞는다', () => {
    const r = run({ count: 3 });
    expect(r.records).toHaveLength(3);
    r.records.forEach((rec, i) => {
      const o = r.results[i]!;
      expect(rec).toEqual({ saveId: 's', bannerId: 'std1', characterId: o.character.id, rarity: o.rarity, pityBefore: o.pityBefore, isNew: o.isNew, at: NOW });
    });
  });
});
