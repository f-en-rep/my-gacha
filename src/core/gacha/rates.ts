// 확률 계산. sinceSix = 이번 뽑기 직전까지 6★ 없이 뽑은 횟수 (이번 뽑기는 sinceSix+1 번째).

import type { Rarity } from '../../types';
import type { GachaRules } from './rules';

/**
 * 이번 뽑기의 6★ 확률.
 * 기본: sinceSix 50 (51번째) → 4%, 51 → 6% … 98 (99번째) → 100%.
 */
export function sixStarRate(sinceSix: number, rules: GachaRules): number {
  const over = sinceSix - rules.pityThreshold + 1;
  const rate = rules.baseRates[6] + (over > 0 ? over * rules.pityStep : 0);
  return Math.min(1, rate);
}

/** 희귀도별 확률. 늘어난 6★ 몫은 나머지에서 원래 비율대로 덜어 낸다 */
export function rarityRates(sinceSix: number, rules: GachaRules): Record<Rarity, number> {
  const six = sixStarRate(sinceSix, rules);
  const restBase = 1 - rules.baseRates[6];
  const scale = restBase > 0 ? (1 - six) / restBase : 0;
  return {
    6: six,
    5: rules.baseRates[5] * scale,
    4: rules.baseRates[4] * scale,
    3: rules.baseRates[3] * scale,
  };
}

/** [0,1) 값 하나로 희귀도 고르기 (6★부터 누적) */
export function rollRarity(r: number, rates: Record<Rarity, number>): Rarity {
  let acc = 0;
  for (const rarity of [6, 5, 4] as const) {
    acc += rates[rarity];
    if (r < acc) return rarity;
  }
  return 3;
}
