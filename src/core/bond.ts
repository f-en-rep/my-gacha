// 호감도 (계약). 순수 함수: 점수 계산과 단계, 보상. 대화 생성은 gen/chat.
import type { Bond } from '../types';

export interface BondLevelInfo {
  level: number;
  /** 다음 단계까지 남은 점수 (최고 단계면 0) */
  toNext: number;
  /** 이 단계에 들어선 점수와 다음 단계 점수 (게이지용) */
  floor: number;
  ceil: number;
}

/** 단계 정보 */
export function bondLevel(_points: number): BondLevelInfo {
  throw new Error('not implemented');
}

/** 대화 한 번(플레이어 한 줄 + 캐릭터 한 줄)으로 얻는 점수를 더한다. 하루 상한을 지킨다 */
export function addChatPoints(_bond: Bond | undefined, _day: string): { bond: Bond; gained: number } {
  throw new Error('not implemented');
}

/** 받을 수 있는데 아직 안 받은 단계 보상 */
export function claimableLevels(_bond: Bond | undefined): number[] {
  throw new Error('not implemented');
}
