// 가챠 규칙 수치 (명일방주 헤드헌팅 기준).
// 전부 이 객체 하나에 모아 두고, 월드가 바꾸고 싶으면 덮어쓴 사본을 넘긴다.

import type { BannerKind, Rarity } from '../../types';

export interface GachaRules {
  /** 기본 확률 (0~1). 합이 1이어야 한다 */
  baseRates: Record<Rarity, number>;
  /** 6★ 없이 이 횟수를 넘기면 천장 가산 시작 (명일방주: 50) */
  pityThreshold: number;
  /** 천장 구간에서 회차마다 더해지는 6★ 확률 (0.02 = +2%p) */
  pityStep: number;
  /** 배너마다 첫 N회 안에 minRarity 이상 1회 보장 */
  firstGuarantee: { pulls: number; minRarity: Rarity };
  /** 해당 희귀도가 나왔을 때 픽업 캐릭터일 확률 */
  featuredChance: Record<BannerKind, { 6: number; 5: number }>;
  /** 한정 배너 1회당 교환 포인트 */
  sparkPerPull: number;
  /** 픽업 6★ 교환에 필요한 포인트 */
  sparkCost: number;
  /** 잠재 최대 단계 */
  maxPotential: number;
  /** 잠재가 꽉 찬 뒤 중복으로 받는 상점 재화 */
  dupeShop: Record<Rarity, number>;
  /** 1회 뽑기 비용 (wallet.pull). 10연차는 그대로 10배 */
  pullCost: number;
  /** 상시 배너들이 함께 쓰는 천장 키 */
  standardPityKey: string;
}

export const ARKNIGHTS_RULES: GachaRules = {
  baseRates: { 6: 0.02, 5: 0.08, 4: 0.5, 3: 0.4 },
  pityThreshold: 50,
  pityStep: 0.02,
  firstGuarantee: { pulls: 10, minRarity: 5 },
  featuredChance: {
    standard: { 6: 0.5, 5: 0.5 },
    limited: { 6: 0.7, 5: 0.5 },
  },
  sparkPerPull: 1,
  sparkCost: 300,
  maxPotential: 6,
  dupeShop: { 6: 15, 5: 8, 4: 3, 3: 1 },
  pullCost: 600,
  standardPityKey: 'standard',
};

/** 높은 희귀도부터 */
export const RARITIES_DESC: readonly Rarity[] = [6, 5, 4, 3];
