// 스토리: 월드 쪽 데이터(만든 것). 월드 팩에 "스토리 포함"으로 넣을 수 있다.
// 어디까지 읽었는지는 Save.story(진행 쪽)에 있다.
import type { Id } from './world';

/** 배경 장소. 그림은 처음 그 장소에 도착했을 때 그린다 */
export interface Location {
  id: Id;
  worldId: Id;
  name: string;
  /** 월드 언어의 짧은 설명 */
  description: string;
  /** 배경 그림용 영어 태그 (인물 없음) */
  imageTags: string;
  /** 배경 Asset id */
  artId?: Id;
  createdAt: string;
}

/** 챕터 계획의 한 장면 */
export interface StoryNode {
  /** 장면 제목. 그 장면에 도착하기 전에는 화면에 숨긴다 */
  title: string;
  /** 플래너가 쓴 지시: 이 장면에서 일어날 일 (작가용, 화면에 보이지 않음) */
  guide: string;
  /** 등장인물 캐릭터 id (월드 캐스트에서). 비어 있어도 된다 */
  castIds: Id[];
  locationId: Id;
}

export type ChapterStatus = 'planned' | 'complete';

export interface Chapter {
  id: Id;
  worldId: Id;
  /** 1부터 */
  index: number;
  title: string;
  /** 플래너가 쓴 줄거리 요약 (스포일러라 화면에는 첫 장면 이후 일부만) */
  synopsis: string;
  nodes: StoryNode[];
  /** 다 쓴 뒤 만든 요약. 다음 챕터 계획과 장면 쓰기에 "지금까지의 이야기"로 들어간다 */
  summary?: string;
  /** 이 챕터가 이야기 전체에서 한 일 한 줄 (스토리 흐름 지시문을 지키기 위한 장부) */
  ledger?: string;
  status: ChapterStatus;
  createdAt: string;
  updatedAt: string;
}

export type SegmentKind = 'narration' | 'line' | 'thought';

/** 장면의 한 토막: 지문, 대사, 속마음 */
export interface Segment {
  kind: SegmentKind;
  /** line·thought일 때 말하는 캐릭터 id. 캐스트 밖 인물이면 비우고 speakerName만 */
  speakerId?: Id;
  speakerName?: string;
  text: string;
}

/** 쓰인 장면 하나 (챕터의 nodes[index]) */
export interface Beat {
  id: Id;
  worldId: Id;
  chapterId: Id;
  index: number;
  segments: Segment[];
  createdAt: string;
}
