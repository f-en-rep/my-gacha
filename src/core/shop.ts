// 상점. 순수 함수: 상점 재화(잠재가 꽉 찬 중복으로 얻음)로 사는 것들.
// 입력 Save는 건드리지 않고 새 Save를 돌려준다 (가챠 코어와 같은 방식).
// 자유 모드에서는 값이 전부 0 (뽑기와 같게).

import type { Character, Rarity, Save } from '../types';
import { ARKNIGHTS_RULES } from './gacha/rules';

export const SHOP_PRICES = {
  /** 뽑기 재화 교환: 한 묶음 */
  bundle: { cost: 10, pull: 300 },
  /** 잠재 +1 (보유 캐릭터, 최대 미만) */
  potential: { 6: 40, 5: 20, 4: 8, 3: 3 } as Record<Rarity, number>,
  /** 미보유 캐릭터 영입 (잠재 1) */
  recruit: { 6: 180, 5: 90, 4: 30, 3: 10 } as Record<Rarity, number>,
} as const;

/** 한 번에 살 수 있는 묶음 수 상한 (자유 모드에서 끝없이 늘지 않게) */
export const MAX_BUNDLES_PER_BUY = 999;

export type ShopError = 'insufficient' | 'not-owned' | 'already-owned' | 'max-potential' | 'bad-amount';

export type ShopResult = { ok: true; save: Save } | { ok: false; error: ShopError };

const price = (save: Save, n: number) => (save.freeMode ? 0 : n);

/** 묶음 count개의 값 (상점 재화) */
export function bundleCost(save: Save, count: number): number {
  return price(save, SHOP_PRICES.bundle.cost * count);
}

export function potentialCost(save: Save, rarity: Rarity): number {
  return price(save, SHOP_PRICES.potential[rarity]);
}

export function recruitCost(save: Save, rarity: Rarity): number {
  return price(save, SHOP_PRICES.recruit[rarity]);
}

/** 지금 살 수 있는 최대 묶음 수 (0이면 못 산다) */
export function maxBundles(save: Save): number {
  if (save.freeMode) return MAX_BUNDLES_PER_BUY;
  return Math.max(0, Math.min(MAX_BUNDLES_PER_BUY, Math.floor(save.wallet.shop / SHOP_PRICES.bundle.cost)));
}

/** 뽑기 재화 교환: 묶음 count개 */
export function buyPullBundles(save: Save, count: number, now: string): ShopResult {
  if (!Number.isInteger(count) || count < 1 || count > MAX_BUNDLES_PER_BUY) return { ok: false, error: 'bad-amount' };
  const cost = bundleCost(save, count);
  if (save.wallet.shop < cost) return { ok: false, error: 'insufficient' };
  return {
    ok: true,
    save: {
      ...save,
      wallet: { pull: save.wallet.pull + SHOP_PRICES.bundle.pull * count, shop: save.wallet.shop - cost },
      updatedAt: now,
    },
  };
}

/** 잠재 올리기: 보유 캐릭터 잠재 +1 */
export function raisePotential(save: Save, character: Character, now: string, maxPotential = ARKNIGHTS_RULES.maxPotential): ShopResult {
  const owned = save.owned[character.id];
  if (!owned) return { ok: false, error: 'not-owned' };
  if (owned.potential >= maxPotential) return { ok: false, error: 'max-potential' };
  const cost = potentialCost(save, character.rarity);
  if (save.wallet.shop < cost) return { ok: false, error: 'insufficient' };
  return {
    ok: true,
    save: {
      ...save,
      wallet: { ...save.wallet, shop: save.wallet.shop - cost },
      owned: { ...save.owned, [character.id]: { ...owned, potential: owned.potential + 1 } },
      updatedAt: now,
    },
  };
}

/** 캐릭터 영입: 미보유 캐릭터를 잠재 1로 */
export function recruitCharacter(save: Save, character: Character, now: string): ShopResult {
  if (save.owned[character.id]) return { ok: false, error: 'already-owned' };
  const cost = recruitCost(save, character.rarity);
  if (save.wallet.shop < cost) return { ok: false, error: 'insufficient' };
  return {
    ok: true,
    save: {
      ...save,
      wallet: { ...save.wallet, shop: save.wallet.shop - cost },
      owned: { ...save.owned, [character.id]: { characterId: character.id, potential: 1, obtainedAt: now } },
      updatedAt: now,
    },
  };
}

/** 화면용 한국어 오류 */
export const SHOP_ERROR_TEXT: Record<ShopError, string> = {
  insufficient: '상점 재화가 부족합니다.',
  'not-owned': '보유하지 않은 캐릭터입니다.',
  'already-owned': '이미 보유한 캐릭터입니다.',
  'max-potential': '한계 돌파가 이미 최대입니다.',
  'bad-amount': '수량이 올바르지 않습니다.',
};
