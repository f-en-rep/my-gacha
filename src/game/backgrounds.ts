// 장소 배경 그리기 (계약). 그림 연결이 없으면 아무것도 하지 않는다.
import type { Id } from '../types';

/** 장소 배경을 그려 Location.artId를 채운다 (가로 그림). 이미 있으면 그 id. 그림 연결이 없으면 undefined */
export async function paintLocation(_locationId: Id, _opts: { priority?: 'foreground' | 'background'; force?: boolean; signal?: AbortSignal } = {}): Promise<Id | undefined> {
  return undefined;
}
