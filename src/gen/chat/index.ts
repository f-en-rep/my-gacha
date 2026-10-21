// 1:1 대화 생성 (계약). 구현은 이 폴더 안에서 한다.
import type { ChatLine, Id } from '../../types';

export interface ChatGenOptions {
  signal?: AbortSignal;
}

/**
 * 플레이어 말을 저장하고, 캐릭터의 답을 써서 저장한 뒤 그 줄을 돌려준다 (문장 연결, 없으면 구조화 연결).
 * 호감도 점수도 더한다. 보유한 캐릭터만 대화할 수 있다.
 */
export async function sendChat(_saveId: Id, _characterId: Id, _text: string, _opts: ChatGenOptions = {}): Promise<ChatLine> {
  throw new Error('not implemented');
}

/** 마지막 캐릭터 답을 지우고 다시 쓴다 */
export async function regenerateLast(_saveId: Id, _characterId: Id, _opts: ChatGenOptions = {}): Promise<ChatLine> {
  throw new Error('not implemented');
}
