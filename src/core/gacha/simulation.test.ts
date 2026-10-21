// 10만 회 시뮬레이션: 실제 비율이 이론값(재생 과정으로 계산)과 맞는지, 99회를 넘는 연속 미출현이 없는지.
import { expect, it } from 'vitest';
import type { Rarity } from '../../types';
import { ARKNIGHTS_RULES as R } from './rules';
import { rarityRates } from './rates';
import { pull } from './pull';
import { makeBanner, makeCast, makeSave } from './test-fixtures';

const N = 100_000;

/** 장기 평균 희귀도 비율. sinceSix=j 상태에 머무는 비율 ∝ 그 상태까지 6★ 없이 살아남을 확률 */
function theoreticalRates(): Record<Rarity, number> {
  let survive = 1;
  let total = 0;
  const acc = { 6: 0, 5: 0, 4: 0, 3: 0 } as Record<Rarity, number>;
  for (let j = 0; survive > 0; j++) {
    const r = rarityRates(j, R);
    total += survive;
    for (const k of [6, 5, 4, 3] as const) acc[k] += survive * r[k];
    survive *= 1 - r[6];
  }
  for (const k of [6, 5, 4, 3] as const) acc[k] /= total;
  return acc;
}

it(`${N}회 시뮬레이션`, () => {
  const res = pull({
    save: makeSave({ freeMode: true, rngState: 20260101 }),
    banner: makeBanner(),
    cast: makeCast(),
    rules: R,
    count: N,
    now: '',
  });
  if (!res.ok) throw new Error(res.error);

  const counts = { 6: 0, 5: 0, 4: 0, 3: 0 } as Record<Rarity, number>;
  let streak = 0;
  let longest = 0;
  for (const o of res.results) {
    counts[o.rarity]++;
    streak = o.rarity === 6 ? 0 : streak + 1;
    longest = Math.max(longest, streak);
    expect(o.pityBefore).toBeLessThanOrEqual(98);
  }
  const observed = Object.fromEntries(([6, 5, 4, 3] as const).map((k) => [k, counts[k] / N])) as Record<Rarity, number>;
  const expected = theoreticalRates();
  console.log('observed', observed, 'expected', expected, 'longest streak', longest);

  // 명일방주의 알려진 실효 6★ 확률 ≈ 2.9%
  expect(expected[6]).toBeGreaterThan(0.028);
  expect(expected[6]).toBeLessThan(0.03);
  expect(observed[6]).toBeGreaterThan(0.027);
  expect(observed[6]).toBeLessThan(0.031);
  // 나머지는 이론값 ± 4 표준편차 정도
  expect(Math.abs(observed[5] - expected[5])).toBeLessThan(0.004);
  expect(Math.abs(observed[4] - expected[4])).toBeLessThan(0.007);
  expect(Math.abs(observed[3] - expected[3])).toBeLessThan(0.007);
  expect(longest).toBeLessThan(99);
});
