// 태그 목록 기본값, 희귀도↔특징 연동, 모델이 쓴 태그를 목록 값으로 맞추는 정규화.
import type { Rarity, TagCatalog } from "../../types";

/** 특징(trait) 목록의 순서 = 이 희귀도 순서. trait[0]은 3★, trait[3]은 6★ */
export const TRAIT_RARITIES: readonly Rarity[] = [3, 4, 5, 6];

/** 언어별 기본 위치 이름 [근거리, 원거리]. 아는 언어는 항상 이 값을 쓴다 */
export const DEFAULT_POSITIONS: Record<string, [string, string]> = {
  ko: ["근거리", "원거리"],
  en: ["Melee", "Ranged"],
  ja: ["近距離", "遠距離"],
  zh: ["近战", "远程"],
};

/** 언어별 기본 특징 이름 (3★, 4★, 5★, 6★ 순). 모델이 제대로 못 주면 쓴다 */
export const DEFAULT_TRAITS: Record<string, [string, string, string, string]> =
  {
    ko: ["신입", "숙련", "베테랑", "엘리트"],
    en: ["Rookie", "Skilled", "Veteran", "Elite"],
    ja: ["新人", "熟練", "ベテラン", "エリート"],
    zh: ["新人", "熟练", "老练", "精英"],
  };

function baseLang(language: string): string {
  return language.trim().toLowerCase().split(/[-_]/)[0] ?? "";
}

export function knownPositions(language: string): [string, string] | undefined {
  return DEFAULT_POSITIONS[baseLang(language)];
}

export function defaultPositions(language: string): [string, string] {
  return knownPositions(language) ?? DEFAULT_POSITIONS.en!;
}

export function defaultTraits(
  language: string,
): [string, string, string, string] {
  return DEFAULT_TRAITS[baseLang(language)] ?? DEFAULT_TRAITS.en!;
}

/** 희귀도에 연동된 특징 태그 */
export function traitForRarity(
  catalog: TagCatalog,
  rarity: Rarity,
): string | undefined {
  const i = TRAIT_RARITIES.indexOf(rarity);
  return catalog.trait[i] ?? catalog.trait[catalog.trait.length - 1];
}

/** 0 = 근거리, 1 = 원거리 (TagCatalog.position의 순서) */
export function positionIndex(catalog: TagCatalog, position: string): 0 | 1 {
  return catalog.position.indexOf(position) === 1 ? 1 : 0;
}

/** 비교용: 대소문자, 공백, 문장부호 차이를 없앤다 */
export function normTag(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_\-·・.,/\\()[\]{}'"`~!?:;★*]+/g, "");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(
        prev[j]! + 1,
        prev[j - 1]! + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/**
 * 모델이 쓴 값을 목록 값 하나로 맞춘다. 못 맞추면 undefined.
 * 순서: 정확히 같음 → 동의어 → 한쪽이 다른 쪽을 포함(유일할 때) → 철자 한두 글자 차이(유일할 때)
 */
export function matchTag(
  value: string,
  options: readonly string[],
  synonyms: Record<string, string> = {},
): string | undefined {
  const v = normTag(value);
  if (!v) return undefined;
  const normed = options.map((o) => normTag(o));
  const exact = normed.indexOf(v);
  if (exact >= 0) return options[exact];
  const syn = synonyms[v];
  if (syn !== undefined && options.includes(syn)) return syn;

  const contains = options.filter((_, i) => {
    const o = normed[i]!;
    return (
      o.length > 0 &&
      (v.includes(o) || o.includes(v)) &&
      Math.min(o.length, v.length) >= 2
    );
  });
  if (contains.length === 1) return contains[0];

  const maxDist = v.length >= 5 ? 2 : 1;
  let best: string | undefined;
  let bestDist = Infinity;
  let tie = false;
  options.forEach((o, i) => {
    const d = levenshtein(v, normed[i]!);
    if (d < bestDist) {
      bestDist = d;
      best = o;
      tie = false;
    } else if (d === bestDist) tie = true;
  });
  if (best !== undefined && !tie && bestDist <= maxDist && bestDist < v.length)
    return best;
  return undefined;
}

const MELEE_WORDS = [
  "melee",
  "close",
  "closerange",
  "shortrange",
  "front",
  "frontline",
  "vanguard",
  "근거리",
  "근접",
  "전방",
  "近距離",
  "近接",
  "近战",
  "近戰",
];
const RANGED_WORDS = [
  "ranged",
  "range",
  "longrange",
  "distance",
  "back",
  "backline",
  "rear",
  "원거리",
  "원격",
  "후방",
  "遠距離",
  "遠隔",
  "远程",
  "遠程",
];

/** 위치 값 맞추기: 목록 값 외에 어느 언어로든 근거리/원거리를 뜻하는 말을 받아 준다 */
export function matchPosition(
  value: string,
  catalog: TagCatalog,
): string | undefined {
  const [melee, ranged] = catalog.position;
  if (melee === undefined || ranged === undefined) return undefined;
  const syn: Record<string, string> = {};
  for (const w of MELEE_WORDS) syn[normTag(w)] = melee;
  for (const w of RANGED_WORDS) syn[normTag(w)] = ranged;
  return matchTag(value, catalog.position, syn);
}
