// 월드 생성 (계약). 구현은 이 폴더 안에서 한다.
import type { Id, Rarity } from '../../types';

/** 사용자가 마법사에서 입력하는 것 */
export interface WorldInput {
  /** 비우면 AI가 짓는다 */
  name?: string;
  /** 예: "ko" */
  language: string;
  description: string;
  scenario: string;
  directives: string;
  /** 비우면 AI가 세계관에 맞게 정한다 (영어 태그) */
  artStyle?: string;
}

/** 시작 캐스트 구성 (설계 문서: 6★ 2 / 5★ 3 / 4★ 4 / 3★ 4) */
export const START_CAST: Record<Rarity, number> = { 6: 2, 5: 3, 4: 4, 3: 4 };

export interface GenerateOptions {
  signal?: AbortSignal;
  /** 진행 상황은 World.genProgress에도 기록되지만, 화면이 바로 받고 싶을 때 */
  onProgress?: (stage: string, done: number, total: number) => void;
}

/** 입력만 담은 월드(status: draft)를 만들고 id를 돌려준다. AI 호출 없음 */
export async function createWorldDraft(_input: WorldInput): Promise<Id> {
  throw new Error('not implemented');
}

/**
 * 월드를 끝까지 생성한다: 세계 설정(태그 목록, 재화 이름, 화풍) → 6★·5★ 한 명씩 → 4★·3★ 묶음 → 상시 배너.
 * 이미 만들어진 부분은 건너뛰므로, 실패 후 다시 부르면 이어서 한다. 끝나면 status: ready.
 * 그림은 그리지 않는다 (처음 뽑을 때 그린다).
 */
export async function generateWorld(_worldId: Id, _opts: GenerateOptions = {}): Promise<void> {
  throw new Error('not implemented');
}
