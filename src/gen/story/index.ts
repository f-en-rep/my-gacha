// 스토리 생성 (계약). 구현은 이 폴더 안에서 한다.
// 등장인물은 "내가 뽑은 캐릭터"가 아니라 월드 캐스트에서 고른다 (PLAN 2-3: 친구에게 줘도 진행과 안 꼬이게).
import type { Beat, Id } from '../../types';

/** 챕터 하나의 장면 수 */
export const BEATS_PER_CHAPTER = 6;

export interface StoryGenOptions {
  signal?: AbortSignal;
  /** 화면에 보여 줄 진행 문구 */
  onProgress?: (stage: string) => void;
}

/**
 * 다음 챕터를 계획해 저장하고 id를 돌려준다 (구조화 연결).
 * 앞 챕터들의 요약·장부와 작가 지시문을 읽고, 장면 BEATS_PER_CHAPTER개(제목, 지시, 등장인물, 장소)를 정한다.
 * 새 장소가 필요하면 Location을 만든다. 장면 본문은 쓰지 않는다.
 */
export async function planNextChapter(_worldId: Id, _opts: StoryGenOptions = {}): Promise<Id> {
  throw new Error('not implemented');
}

/**
 * 장면 본문. 이미 있으면 그대로, 없으면 써서 저장한다 (문장 연결, 없으면 구조화 연결).
 * 같은 장면을 동시에 두 번 쓰지 않는다.
 */
export async function ensureBeat(_chapterId: Id, _index: number, _opts: StoryGenOptions & { priority?: 'foreground' | 'background' } = {}): Promise<Beat> {
  throw new Error('not implemented');
}

/** 다음 장면을 뒤에서 미리 써 둔다. 실패해도 조용히 넘어간다 */
export function prefetchBeat(_chapterId: Id, _index: number): void {}

/** 챕터를 다 읽은 뒤: 요약과 장부 한 줄을 만들고 status를 complete로 */
export async function finishChapter(_chapterId: Id, _opts: StoryGenOptions = {}): Promise<void> {
  throw new Error('not implemented');
}
