// 생성 작업 큐 (계약). 연결마다 한 번에 하나, 화면에서 기다리는 작업 먼저.

export type JobPriority = 'foreground' | 'background';

export interface EnqueueOptions {
  priority?: JobPriority;
  /** 같은 키의 이전 작업이 끝난 뒤 최소 이만큼 쉬고 시작 (그림 밴 방지) */
  minIntervalMs?: number;
  signal?: AbortSignal;
}

/** key: 보통 연결 프로필 id */
export function enqueue<T>(_key: string, _job: () => Promise<T>, _opts: EnqueueOptions = {}): Promise<T> {
  throw new Error('not implemented');
}
