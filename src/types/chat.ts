// 1:1 대화: 진행 쪽 데이터(나만의 것). 월드 팩에는 들어가지 않고, 세이브 백업에만 들어간다.
import type { Id } from './world';

/** 대화 한 줄 */
export interface ChatLine {
  /** IndexedDB 자동 번호 */
  id?: number;
  saveId: Id;
  characterId: Id;
  /** user = 플레이어, char = 캐릭터 */
  role: 'user' | 'char';
  text: string;
  at: string;
}

/** 캐릭터 하나와의 호감도 */
export interface Bond {
  /** 쌓인 호감도 점수 */
  points: number;
  /** 보상을 받은 단계들 */
  claimed: number[];
  /** 오늘 얻은 점수 (하루 상한용) */
  today?: { day: string; points: number };
}
