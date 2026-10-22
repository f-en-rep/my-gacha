// 기록: 월드 쪽 데이터(이야기에서 나온 것). 스토리와 함께 월드 팩·백업에 들어간다.
// 사건·인물·물건. 챕터를 마칠 때 자동으로 쌓이고, 직접 적어 넣을 수도 있다.
import type { Id } from './world';

/** event = 큰 사건 / person = 캐스트(가챠 캐릭터)가 아닌 인물 / item = 얻었거나 얽힌 물건 */
export type LoreKind = 'event' | 'person' | 'item';

export interface LoreEntry {
  id: Id;
  worldId: Id;
  kind: LoreKind;
  /** 사건은 짧은 제목, 인물·물건은 이름 */
  name: string;
  /** 한두 줄 설명 (월드 언어) */
  summary: string;
  /** 처음 (또는 마지막으로 고친) 챕터 */
  chapterId?: Id;
  chapterIndex?: number;
  /** 얽힌 캐스트 캐릭터 id */
  castIds?: Id[];
  /** story = 챕터 마무리에서 자동 / manual = 직접 적음 (자동으로 덮어쓰지 않는다) */
  source: 'story' | 'manual';
  createdAt: string;
  updatedAt: string;
}
