import type { Id, Rarity } from './world';
import type { Bond } from './chat';

/** 진행 쪽 데이터: 나만의 것. 월드 팩에는 절대 들어가지 않는다. */

export interface OwnedCharacter {
  characterId: Id;
  /** 잠재 단계 1~6 */
  potential: number;
  obtainedAt: string;
}

/** 천장 카운터 하나. 상시 배너는 "standard" 키 하나를 공유, 한정 배너는 배너 id를 키로 쓴다 */
export interface PityCounter {
  /** 마지막 6★ 이후 뽑은 횟수 */
  sinceSix: number;
}

export interface BannerProgress {
  /** 이 배너에서 뽑은 총 횟수 (첫 10회 보장 판정용) */
  pulls: number;
  /** 첫 10회 안에 5★ 이상이 이미 나왔는지 */
  firstTenSatisfied: boolean;
  /** 한정 배너 300회 교환 포인트 */
  sparkPoints: number;
}

export interface PullRecord {
  /** IndexedDB 자동 번호 */
  id?: number;
  saveId: Id;
  bannerId: Id;
  characterId: Id;
  rarity: Rarity;
  /** 이 뽑기 직전의 천장 카운터 값 */
  pityBefore: number;
  isNew: boolean;
  at: string;
}

/** 챕터 하나를 어디까지 읽었는지 */
export interface StoryProgress {
  /** 지금 읽는 장면 (nodes 인덱스) */
  beat: number;
  /** 그 장면 안의 토막 인덱스 (이어 읽기) */
  segment: number;
  /** 가장 멀리 간 장면. "처음부터"로 돌아가도 그 장면까지는 제목을 보여 준다 */
  furthest?: number;
  /** 끝까지 읽은 시각. 처음 다 읽을 때 보상을 준다 */
  clearedAt?: string;
}

export interface Wallet {
  pull: number;
  shop: number;
}

export interface Save {
  id: Id;
  worldId: Id;
  name: string;
  wallet: Wallet;
  owned: Record<Id, OwnedCharacter>;
  /** 키: "standard" 또는 한정 배너 id */
  pity: Record<string, PityCounter>;
  banners: Record<Id, BannerProgress>;
  /** 재화를 마음대로 채우는 자유 모드 */
  freeMode: boolean;
  /** 난수 시드. 뽑을 때마다 갱신 */
  rngState: number;
  /** 로비에 세울 캐릭터 */
  featuredCharacterId?: Id;
  /** 마지막으로 매일 보상을 받은 날 (YYYY-MM-DD, 기기 시간대) */
  lastDailyClaim?: string;
  /** 키: 챕터 id */
  story?: Record<Id, StoryProgress>;
  /** 키: 캐릭터 id. 1:1 대화로 쌓는 호감도 */
  bonds?: Record<Id, Bond>;
  /** 대화에서 캐릭터가 부르는 플레이어 이름 (비우면 월드에 맞게 "당신") */
  playerName?: string;
  createdAt: string;
  updatedAt: string;
}
