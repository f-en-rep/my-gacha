// 뽑기 본체. 순수 함수: 입력(Save)은 건드리지 않고 새 Save를 돌려준다.
// 난수는 save.rngState에서 이어 쓰고, 끝난 상태를 새 Save에 적어 둔다 (같은 Save면 같은 결과).

import { createRng, pick, type Rng } from '../rng';
import type {
  Banner,
  BannerProgress,
  Character,
  Id,
  OwnedCharacter,
  PityCounter,
  PullRecord,
  Rarity,
  Save,
} from '../../types';
import { RARITIES_DESC, type GachaRules } from './rules';
import { rarityRates, rollRarity } from './rates';

export interface PullOutcome {
  character: Character;
  /** 실제로 나온 캐릭터의 희귀도 (빈 희귀도 대체가 일어나면 굴린 값과 다를 수 있다) */
  rarity: Rarity;
  isNew: boolean;
  /** 이 뽑기 뒤의 잠재 단계 */
  potential: number;
  /** 잠재가 꽉 차서 받은 상점 재화 */
  shopGained: number;
  /** 이 뽑기 직전의 천장 카운터 */
  pityBefore: number;
  /** 픽업 캐릭터인지 */
  featured: boolean;
}

export interface PullInput {
  save: Save;
  banner: Banner;
  /** 월드 전체 캐스트. banner.pool이 비어 있으면 이걸 그대로 쓴다 */
  cast: readonly Character[];
  rules: GachaRules;
  /** 1 또는 10 (아무 양수나 된다) */
  count: number;
  /** ISO 시각 */
  now: string;
}

export type PullError = 'insufficient-funds' | 'empty-pool';

export type PullResult =
  | { ok: true; save: Save; results: PullOutcome[]; records: PullRecord[] }
  | { ok: false; error: PullError };

export const EMPTY_PROGRESS: BannerProgress = { pulls: 0, firstTenSatisfied: false, sparkPoints: 0 };

/** 상시 배너는 공용 키, 한정 배너는 배너 id */
export function pityKey(banner: Banner, rules: GachaRules): string {
  return banner.kind === 'limited' ? banner.id : rules.standardPityKey;
}

/**
 * 이 배너에서 나올 수 있는 캐릭터.
 * banner.pool이 있으면 그 id들 + 픽업 id들(풀에 빠져 있어도 픽업은 나와야 하므로), 없으면 캐스트 전체.
 */
export function bannerPool(banner: Banner, cast: readonly Character[]): Character[] {
  if (!banner.pool || banner.pool.length === 0) return [...cast];
  const ids = new Set<Id>([...banner.pool, ...banner.featured6, ...banner.featured5]);
  return cast.filter((c) => ids.has(c.id));
}

/**
 * 희귀도가 비어 있으면 아래 희귀도로 내려가며 캐릭터가 있는 곳을 찾는다.
 * 아래에도 없으면 위로 올라간다. 풀 전체가 비었으면 null.
 */
export function resolveRarity(want: Rarity, pool: readonly Character[]): Rarity | null {
  const has = (r: Rarity) => pool.some((c) => c.rarity === r);
  if (has(want)) return want;
  for (const r of RARITIES_DESC) if (r < want && has(r)) return r;
  for (const r of [...RARITIES_DESC].reverse()) if (r > want && has(r)) return r;
  return null;
}

/**
 * 희귀도 안에서 캐릭터 고르기.
 * 6★·5★는 featuredChance 확률로 픽업 중에서, 아니면 픽업이 아닌 쪽에서 균등하게.
 * 픽업이 없으면 비픽업에서, 비픽업이 없으면 픽업에서 고른다.
 */
function pickCharacter(
  rng: Rng,
  rarity: Rarity,
  pool: readonly Character[],
  banner: Banner,
  rules: GachaRules,
): { character: Character; featured: boolean } {
  const inRarity = pool.filter((c) => c.rarity === rarity);
  const featuredIds = rarity === 6 ? banner.featured6 : rarity === 5 ? banner.featured5 : [];
  const featured = inRarity.filter((c) => featuredIds.includes(c.id));
  const off = inRarity.filter((c) => !featuredIds.includes(c.id));
  // 픽업 판정용 난수는 6★·5★일 때 항상 하나 소비한다 (결과 재현이 풀 구성에 덜 흔들리게)
  let wantFeatured = false;
  if (rarity === 6 || rarity === 5) {
    wantFeatured = rng.next() < rules.featuredChance[banner.kind][rarity];
  }
  const useFeatured = featured.length > 0 && (wantFeatured || off.length === 0);
  const character = pick(rng, useFeatured ? featured : off);
  return { character, featured: useFeatured };
}

/** 보유 목록에 넣기. 중복이면 잠재 +1, 최대면 상점 재화. owned는 이미 복사된 것이어야 한다 */
export function grantCharacter(
  owned: Record<Id, OwnedCharacter>,
  character: Character,
  rules: GachaRules,
  now: string,
): { isNew: boolean; potential: number; shopGained: number } {
  const prev = owned[character.id];
  if (!prev) {
    owned[character.id] = { characterId: character.id, potential: 1, obtainedAt: now };
    return { isNew: true, potential: 1, shopGained: 0 };
  }
  if (prev.potential < rules.maxPotential) {
    const potential = prev.potential + 1;
    owned[character.id] = { ...prev, potential };
    return { isNew: false, potential, shopGained: 0 };
  }
  return { isNew: false, potential: prev.potential, shopGained: rules.dupeShop[character.rarity] };
}

/** count회 뽑기. 10연차도 1회를 10번 순서대로 돌린다 */
export function pull({ save, banner, cast, rules, count, now }: PullInput): PullResult {
  const pool = bannerPool(banner, cast);
  if (pool.length === 0) return { ok: false, error: 'empty-pool' };

  const n = Math.max(0, Math.floor(count));
  const cost = save.freeMode ? 0 : rules.pullCost * n;
  if (save.wallet.pull < cost) return { ok: false, error: 'insufficient-funds' };

  const rng = createRng(save.rngState);
  const key = pityKey(banner, rules);
  const pity: PityCounter = { ...(save.pity[key] ?? { sinceSix: 0 }) };
  const progress: BannerProgress = { ...(save.banners[banner.id] ?? EMPTY_PROGRESS) };
  const owned = { ...save.owned };
  let shop = save.wallet.shop;

  const results: PullOutcome[] = [];
  const records: PullRecord[] = [];
  const { pulls: guaranteeAt, minRarity } = rules.firstGuarantee;

  for (let i = 0; i < n; i++) {
    const pityBefore = pity.sinceSix;
    let rolled = rollRarity(rng.next(), rarityRates(pityBefore, rules));

    // 첫 N회 보장: N번째 뽑기까지 minRarity 이상이 없었으면 N번째를 minRarity로 올린다
    const nth = progress.pulls + 1;
    if (!progress.firstTenSatisfied && nth === guaranteeAt && rolled < minRarity) {
      rolled = minRarity;
    }

    const rarity = resolveRarity(rolled, pool)!;
    const { character, featured } = pickCharacter(rng, rarity, pool, banner, rules);
    const granted = grantCharacter(owned, character, rules, now);
    shop += granted.shopGained;

    pity.sinceSix = rarity === 6 ? 0 : pityBefore + 1;
    progress.pulls = nth;
    if (nth <= guaranteeAt && rarity >= minRarity) progress.firstTenSatisfied = true;
    if (banner.kind === 'limited') progress.sparkPoints += rules.sparkPerPull;

    results.push({ character, rarity, featured, pityBefore, ...granted });
    records.push({
      saveId: save.id,
      bannerId: banner.id,
      characterId: character.id,
      rarity,
      pityBefore,
      isNew: granted.isNew,
      at: now,
    });
  }

  const next: Save = {
    ...save,
    wallet: { pull: save.wallet.pull - cost, shop },
    owned,
    pity: { ...save.pity, [key]: pity },
    banners: { ...save.banners, [banner.id]: progress },
    rngState: rng.state,
    updatedAt: now,
  };
  return { ok: true, save: next, results, records };
}
