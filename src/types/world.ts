// 월드 쪽 데이터: 만든 것. 월드 팩으로 공유된다.
// 진행(내 재화, 보유 캐릭터, 천장)은 save.ts에 있다.

export const SCHEMA_VERSION = 1;

export type Id = string;

/** 3~6★ */
export type Rarity = 3 | 4 | 5 | 6;

export interface TagCatalog {
  /** 위치: 근거리 / 원거리 */
  position: string[];
  /** 역할: 딜러, 방어형, 치료 ... */
  role: string[];
  /** 속성: 월드가 정함 (불, 물, 바람 ...) */
  element: string[];
  /** 특징: 신입 / 베테랑 / 엘리트 등. 희귀도와 연동 */
  trait: string[];
}

export interface CurrencyNames {
  /** 뽑기 재화 (예: 성석) */
  pull: string;
  /** 중복으로 얻는 상점 재화 (예: 자격증) */
  shop: string;
}

export interface ArtStyle {
  /** 모든 그림 앞에 붙는 화풍 태그 (영어) */
  positiveTags: string;
  negativeTags: string;
}

export interface World {
  id: Id;
  schemaVersion: number;
  name: string;
  /** 생성 텍스트 언어. 예: "ko" */
  language: string;
  /** 세계관 설명 (사용자 입력) */
  description: string;
  /** 시작 상황 / 시나리오 */
  scenario: string;
  /** 작가 지시문. 생성 프롬프트에 그대로 들어간다 */
  directives: string;
  tags: TagCatalog;
  currency: CurrencyNames;
  art: ArtStyle;
  /** 원작자 표시 (선택) */
  author?: string;
  createdAt: string;
  updatedAt: string;
}
