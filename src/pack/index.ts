// 월드 팩과 세이브 백업 (계약). 구현은 이 폴더 안에서 한다.
// 월드 팩: 월드 + 캐릭터 + 배너 + 그림 (+ 선택: 스토리). 진행과 API 키는 절대 넣지 않는다.
// 세이브 백업: 월드 팩 전부 + 그 월드의 세이브와 뽑기 기록. API 키는 넣지 않는다.
import type { Id } from '../types';

export interface ExportOptions {
  includeStory: boolean;
}

export async function exportWorldPack(_worldId: Id, _opts: ExportOptions): Promise<{ blob: Blob; filename: string }> {
  throw new Error('not implemented');
}

/** 새 월드로 들어간다 (같은 월드를 두 번 가져와도 별개의 월드). 새 월드 id를 돌려준다 */
export async function importWorldPack(_file: Blob): Promise<Id> {
  throw new Error('not implemented');
}

export async function exportBackup(_worldId: Id): Promise<{ blob: Blob; filename: string }> {
  throw new Error('not implemented');
}

export async function importBackup(_file: Blob): Promise<Id> {
  throw new Error('not implemented');
}
