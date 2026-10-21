// 호감도 (계약). 순수 함수: 점수 계산과 단계, 보상. 대화 생성은 gen/chat.
import type { Bond } from '../types';

/** 단계별 시작 점수. 인덱스 0 = 1단계 */
export const BOND_THRESHOLDS: readonly number[] = [0, 15, 40, 80, 140, 220, 320, 450, 600, 800];

export const MAX_BOND_LEVEL = BOND_THRESHOLDS.length;

/** 대화 한 번(플레이어 한 줄 + 캐릭터 한 줄)으로 얻는 점수 */
export const BOND_POINTS_PER_CHAT = 3;

/** 캐릭터 하나당 하루에 얻을 수 있는 최대 점수 (대화 10번) */
export const BOND_DAILY_CAP = 30;

/** 단계 보상 (뽑기 재화). 2단계부터 */
export const BOND_REWARDS: Readonly<Record<number, number>> = {
  2: 300,
  3: 300,
  4: 300,
  5: 600,
  6: 600,
  7: 600,
  8: 1200,
  9: 1200,
  10: 1200,
};

/** 단계 이름 (화면용). 인덱스 = 단계 */
export const BOND_TITLES: Readonly<Record<number, string>> = {
  1: '처음 만난 사이',
  2: '낯을 익힌 사이',
  3: '말을 트는 사이',
  4: '편한 사이',
  5: '믿음이 가는 사이',
  6: '가까운 사이',
  7: '마음을 나누는 사이',
  8: '소중한 사이',
  9: '각별한 사이',
  10: '둘도 없는 사이',
};

/** 대화 프롬프트에 넣는 관계 태도 (영어). 단계 묶음별 */
const STANCE_BANDS: { upTo: number; stance: string }[] = [
  {
    upTo: 1,
    stance:
      'You have only just met the player. Be polite but guarded, keep some distance, and do not share anything personal yet.',
  },
  {
    upTo: 3,
    stance:
      'You recognise the player and are getting used to them. Be friendlier and a little curious about them, but still reserved about your own past and feelings.',
  },
  {
    upTo: 5,
    stance:
      'You are comfortable around the player. Speak casually in your own manner, joke a little, and occasionally mention small personal things.',
  },
  {
    upTo: 7,
    stance:
      'You trust the player and enjoy their company. Open up about your worries, past and opinions, and show that you care how they are doing.',
  },
  {
    upTo: 9,
    stance:
      'The player is very important to you. You are openly warm and protective, share secrets and vulnerabilities, and look forward to every talk.',
  },
  {
    upTo: MAX_BOND_LEVEL,
    stance:
      'The player is irreplaceable to you — your closest person. Speak with deep trust and affection (in the way your personality would show it), with no walls left between you.',
  },
];

/** 단계에 맞는 관계 태도 (영어 한두 문장) */
export function bondStance(level: number): string {
  const band = STANCE_BANDS.find((b) => level <= b.upTo) ?? STANCE_BANDS[STANCE_BANDS.length - 1]!;
  return band.stance;
}

export function bondTitle(level: number): string {
  return BOND_TITLES[clampLevel(level)] ?? BOND_TITLES[1]!;
}

function clampLevel(level: number): number {
  return Math.min(MAX_BOND_LEVEL, Math.max(1, Math.floor(level)));
}

export interface BondLevelInfo {
  level: number;
  /** 다음 단계까지 남은 점수 (최고 단계면 0) */
  toNext: number;
  /** 이 단계에 들어선 점수와 다음 단계 점수 (게이지용) */
  floor: number;
  ceil: number;
}

/** 단계 정보. 최고 단계면 floor = ceil = 마지막 문턱, toNext = 0 */
export function bondLevel(points: number): BondLevelInfo {
  const p = Number.isFinite(points) ? Math.max(0, points) : 0;
  let level = 1;
  for (let i = 0; i < BOND_THRESHOLDS.length; i++) if (p >= BOND_THRESHOLDS[i]!) level = i + 1;
  const floor = BOND_THRESHOLDS[level - 1]!;
  const ceil = BOND_THRESHOLDS[level] ?? floor;
  return { level, toNext: Math.max(0, ceil - p), floor, ceil };
}

/** 대화 한 번(플레이어 한 줄 + 캐릭터 한 줄)으로 얻는 점수를 더한다. 하루 상한을 지킨다 */
export function addChatPoints(bond: Bond | undefined, day: string): { bond: Bond; gained: number } {
  const base: Bond = bond ?? { points: 0, claimed: [] };
  const todayPoints = base.today?.day === day ? base.today.points : 0;
  const gained = Math.max(0, Math.min(BOND_POINTS_PER_CHAT, BOND_DAILY_CAP - todayPoints));
  return {
    bond: { ...base, claimed: [...base.claimed], points: base.points + gained, today: { day, points: todayPoints + gained } },
    gained,
  };
}

/** 받을 수 있는데 아직 안 받은 단계 보상 (2단계부터, 낮은 순) */
export function claimableLevels(bond: Bond | undefined): number[] {
  if (!bond) return [];
  const { level } = bondLevel(bond.points);
  const out: number[] = [];
  for (let l = 2; l <= level; l++) if (!bond.claimed.includes(l)) out.push(l);
  return out;
}
