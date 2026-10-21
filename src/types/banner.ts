import type { Id } from './world';

/** standard = 상시 (천장 공유), limited = 한정 (배너마다 천장 따로, 300회 교환) */
export type BannerKind = 'standard' | 'limited';

export interface Banner {
  id: Id;
  worldId: Id;
  kind: BannerKind;
  name: string;
  /** 픽업 6★ 캐릭터 id */
  featured6: Id[];
  /** 픽업 5★ 캐릭터 id */
  featured5: Id[];
  /** 이 배너에서 나올 수 있는 캐릭터. 비어 있으면 월드 전체 캐스트 */
  pool?: Id[];
  /** ISO 날짜. 없으면 상시 열림 */
  startsAt?: string;
  endsAt?: string;
  artId?: Id;
  createdAt: string;
}
