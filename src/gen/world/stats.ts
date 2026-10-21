// 전투 능력치는 모델에게 묻지 않고 코드로 계산한다 (희귀도 × 전투 유형 × 위치, 캐릭터 id로 시드 고정).
import { createRng } from "../../core/rng";
import type { CombatStats, Rarity } from "../../types";

export const ARCHETYPES = [
  "striker",
  "tank",
  "healer",
  "support",
  "controller",
  "summoner",
  "specialist",
] as const;
export type Archetype = (typeof ARCHETYPES)[number];

/** 희귀도별 기본값 */
export const RARITY_BASE: Record<
  Rarity,
  { hp: number; atk: number; def: number; spd: number }
> = {
  3: { hp: 900, atk: 220, def: 90, spd: 90 },
  4: { hp: 1200, atk: 300, def: 120, spd: 95 },
  5: { hp: 1550, atk: 390, def: 160, spd: 100 },
  6: { hp: 2000, atk: 500, def: 200, spd: 105 },
};

/** 전투 유형별 배율 */
export const ARCHETYPE_MUL: Record<
  Archetype,
  { hp: number; atk: number; def: number; spd: number }
> = {
  striker: { hp: 0.9, atk: 1.25, def: 0.85, spd: 1.05 },
  tank: { hp: 1.4, atk: 0.75, def: 1.5, spd: 0.9 },
  healer: { hp: 0.95, atk: 0.8, def: 0.9, spd: 1.0 },
  support: { hp: 1.0, atk: 0.85, def: 1.0, spd: 1.1 },
  controller: { hp: 0.95, atk: 0.95, def: 0.95, spd: 1.05 },
  summoner: { hp: 0.9, atk: 0.95, def: 0.9, spd: 1.0 },
  specialist: { hp: 1.0, atk: 1.0, def: 1.0, spd: 1.0 },
};

/** 위치별 배율 */
export const POSITION_MUL = {
  melee: { hp: 1.1, atk: 1.0, def: 1.1, spd: 1.0 },
  ranged: { hp: 0.9, atk: 1.05, def: 0.85, spd: 1.0 },
} as const;

/** 역할 이름(월드 언어)에서 전투 유형을 짐작하는 낱말. 위에서부터 먼저 맞는 것 */
const ARCHETYPE_WORDS: [Archetype, string[]][] = [
  [
    "healer",
    [
      "heal",
      "medic",
      "cleric",
      "priest",
      "cure",
      "restor",
      "치료",
      "힐",
      "회복",
      "의무",
      "치유",
      "사제",
      "衛生",
      "医",
      "治",
      "癒",
      "回復",
      "回复",
    ],
  ],
  [
    "tank",
    [
      "tank",
      "guard",
      "defend",
      "defens",
      "protect",
      "shield",
      "bulwark",
      "vanguard",
      "방어",
      "탱",
      "수호",
      "방패",
      "호위",
      "守",
      "防",
      "盾",
      "重装",
    ],
  ],
  ["summoner", ["summon", "conjur", "familiar", "소환", "召"]],
  [
    "controller",
    [
      "control",
      "crowd",
      "cc",
      "debuff",
      "disrupt",
      "trap",
      "hex",
      "제어",
      "군중",
      "방해",
      "디버프",
      "약화",
      "함정",
      "妨害",
      "控制",
      "制御",
    ],
  ],
  [
    "support",
    [
      "support",
      "buff",
      "bard",
      "assist",
      "utility",
      "tactic",
      "지원",
      "보조",
      "버프",
      "전술",
      "支援",
      "辅助",
      "補助",
    ],
  ],
  [
    "striker",
    [
      "dps",
      "damage",
      "attack",
      "assault",
      "striker",
      "sniper",
      "snipe",
      "caster",
      "mage",
      "warrior",
      "blade",
      "duel",
      "assassin",
      "딜",
      "공격",
      "돌격",
      "저격",
      "암살",
      "마법",
      "전사",
      "검",
      "攻",
      "狙",
      "暗殺",
      "刺客",
      "術",
      "法",
    ],
  ],
];

export function guessArchetype(roles: readonly string[]): Archetype {
  for (const role of roles) {
    const r = role.toLowerCase();
    for (const [arch, words] of ARCHETYPE_WORDS)
      if (words.some((w) => r.includes(w))) return arch;
  }
  return "specialist";
}

/** 문자열 → 32비트 시드 (FNV-1a) */
export function seedFrom(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 같은 id면 항상 같은 값. 각 수치에 ±5% 흔들림.
 * 근거리: 사거리 1, 저지 2~3 (방어형은 3) / 원거리: 사거리 3~4, 저지 0~1
 */
export function computeStats(
  id: string,
  rarity: Rarity,
  archetype: Archetype,
  melee: boolean,
): CombatStats {
  const rng = createRng(seedFrom(id));
  const jitter = () => 0.95 + rng.next() * 0.1;
  const base = RARITY_BASE[rarity];
  const am = ARCHETYPE_MUL[archetype];
  const pm = melee ? POSITION_MUL.melee : POSITION_MUL.ranged;
  const hp = Math.round((base.hp * am.hp * pm.hp * jitter()) / 10) * 10;
  const atk = Math.round(base.atk * am.atk * pm.atk * jitter());
  const def = Math.round(base.def * am.def * pm.def * jitter());
  const spd = Math.round(base.spd * am.spd * pm.spd * jitter());
  const roll = rng.next();
  if (melee) {
    return {
      hp,
      atk,
      def,
      spd,
      range: 1,
      block: archetype === "tank" ? 3 : roll < 0.5 ? 2 : 3,
    };
  }
  const roll2 = rng.next();
  return {
    hp,
    atk,
    def,
    spd,
    range: roll < 0.5 ? 3 : 4,
    block: roll2 < 0.5 ? 0 : 1,
  };
}
