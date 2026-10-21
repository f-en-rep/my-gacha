// 초상화 그리기 (계약). 그림 연결이 없으면 아무것도 하지 않는다.
import type { Id } from '../types';

export interface PaintOptions {
  priority?: 'foreground' | 'background';
  /** 이미 있어도 다시 그리기 */
  force?: boolean;
  signal?: AbortSignal;
}

/** 그림 연결이 지정되어 있는지 */
export function usePaintAvailable(): boolean {
  return false;
}

/**
 * 캐릭터 초상화를 그려 Asset으로 저장하고 Character.portraitId를 채운다. 만든 Asset id를 돌려준다.
 * 그림 연결이 없으면 undefined. 같은 캐릭터를 동시에 두 번 그리지 않는다.
 */
export async function paintPortrait(_characterId: Id, _opts: PaintOptions = {}): Promise<Id | undefined> {
  return undefined;
}
