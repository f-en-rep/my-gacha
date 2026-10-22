// 알림: 이 기기만의 기록. 월드 팩·백업에 들어가지 않는다.
// 뒤에서 돌던 생성이 실패하거나 끝났을 때 남겨 둔다 (놓쳐도 나중에 이유를 볼 수 있게).
import type { Id } from './world';

export type NoticeKind = 'error' | 'done' | 'info';

export type NoticeJob =
  | 'world'
  | 'characters'
  | 'banner'
  | 'story-plan'
  | 'story-beat'
  | 'story-finish'
  | 'portrait'
  | 'location-art'
  | 'banner-art'
  | 'chat'
  | 'card-import';

export interface Notice {
  id: Id;
  /** 같은 일을 가리키는 열쇠 (예: "portrait:char_1"). 안 읽은 같은 알림은 새로 쌓지 않고 고친다 */
  key: string;
  worldId?: Id;
  kind: NoticeKind;
  job: NoticeJob;
  /** 짧은 한국어 제목 */
  title: string;
  /** 오류 글 등 */
  detail?: string;
  /** 가 볼 곳 (해시 경로, 예: "/story/chapter_1") */
  link?: string;
  /** 같은 알림이 몇 번 났는지 (2부터 보여 준다) */
  count: number;
  createdAt: string;
  /** 마지막으로 다시 난 시각. 목록은 이 순서 */
  updatedAt: string;
  readAt?: string;
}
