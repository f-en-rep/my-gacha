// 한정 배너 300회 교환. 포인트를 써서 픽업 6★ 하나를 고른다 (잠재/상점 재화 처리는 뽑기와 같다).

import type { Banner, Character, Id, Save } from '../../types';
import type { GachaRules } from './rules';
import { EMPTY_PROGRESS, grantCharacter, type PullOutcome } from './pull';

export interface SparkInput {
  save: Save;
  banner: Banner;
  cast: readonly Character[];
  rules: GachaRules;
  /** 교환할 캐릭터. banner.featured6 안에 있어야 한다 */
  characterId: Id;
  now: string;
}

export type SparkError = 'not-limited' | 'not-featured' | 'insufficient-points';

export type SparkResult =
  | { ok: true; save: Save; outcome: PullOutcome }
  | { ok: false; error: SparkError };

/** 교환 가능 여부 (UI 버튼용) */
export function canExchangeSpark(save: Save, banner: Banner, rules: GachaRules): boolean {
  return banner.kind === 'limited' && (save.banners[banner.id]?.sparkPoints ?? 0) >= rules.sparkCost;
}

export function exchangeSpark({ save, banner, cast, rules, characterId, now }: SparkInput): SparkResult {
  if (banner.kind !== 'limited') return { ok: false, error: 'not-limited' };
  const character = cast.find((c) => c.id === characterId);
  if (!character || !banner.featured6.includes(characterId)) return { ok: false, error: 'not-featured' };
  const progress = save.banners[banner.id] ?? EMPTY_PROGRESS;
  if (progress.sparkPoints < rules.sparkCost) return { ok: false, error: 'insufficient-points' };

  const owned = { ...save.owned };
  const granted = grantCharacter(owned, character, rules, now);
  const next: Save = {
    ...save,
    owned,
    wallet: { ...save.wallet, shop: save.wallet.shop + granted.shopGained },
    banners: { ...save.banners, [banner.id]: { ...progress, sparkPoints: progress.sparkPoints - rules.sparkCost } },
    updatedAt: now,
  };
  // 교환은 천장 카운터를 건드리지 않는다
  const pityBefore = save.pity[banner.id]?.sinceSix ?? 0;
  return {
    ok: true,
    save: next,
    outcome: { character, rarity: character.rarity, featured: true, pityBefore, ...granted },
  };
}
