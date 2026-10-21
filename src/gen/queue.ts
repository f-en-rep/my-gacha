// 생성 작업 큐 (계약). 연결마다 한 번에 하나, 화면에서 기다리는 작업 먼저.
//
// 규칙
// - 키(보통 연결 프로필 id)마다 동시에 하나만 실행한다.
// - 대기 중인 foreground 작업은 대기 중인 background 작업보다 항상 먼저 시작한다.
//   (이미 실행 중인 작업을 끊지는 않는다.)
// - minIntervalMs: 같은 키의 이전 작업이 "끝난" 시각부터 다음 작업 "시작"까지 최소 간격.
//   간격을 기다리는 동안에는 작업을 꺼내지 않으므로, 그 사이에 들어온 foreground 작업이 앞선다.
// - signal: 대기 중에 중단되면 큐에서 빼고 AbortError로 거절. 실행 중이면 작업 쪽에서 처리
//   (작업 함수가 같은 signal을 쓰도록 호출하는 쪽이 넘겨 준다).
// - 작업이 실패해도 큐는 계속 돈다.

export type JobPriority = 'foreground' | 'background';

export interface EnqueueOptions {
  priority?: JobPriority;
  /** 같은 키의 이전 작업이 끝난 뒤 최소 이만큼 쉬고 시작 (그림 밴 방지) */
  minIntervalMs?: number;
  signal?: AbortSignal;
}

interface QueuedJob {
  run: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  minIntervalMs: number;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface Lane {
  running: boolean;
  /** 마지막 작업이 끝난 시각 (Date.now()) */
  lastEnd?: number;
  foreground: QueuedJob[];
  background: QueuedJob[];
  timer?: ReturnType<typeof setTimeout>;
}

const lanes = new Map<string, Lane>();

function abortError(): DOMException {
  return new DOMException('작업이 취소되었습니다.', 'AbortError');
}

function getLane(key: string): Lane {
  let lane = lanes.get(key);
  if (!lane) {
    lane = { running: false, foreground: [], background: [] };
    lanes.set(key, lane);
  }
  return lane;
}

function removeJob(lane: Lane, job: QueuedJob): boolean {
  for (const list of [lane.foreground, lane.background]) {
    const i = list.indexOf(job);
    if (i >= 0) {
      list.splice(i, 1);
      return true;
    }
  }
  return false;
}

function pump(key: string): void {
  const lane = lanes.get(key);
  if (!lane || lane.running || lane.timer !== undefined) return;

  const next = lane.foreground[0] ?? lane.background[0];
  if (!next) return;

  if (lane.lastEnd !== undefined && next.minIntervalMs > 0) {
    const wait = lane.lastEnd + next.minIntervalMs - Date.now();
    if (wait > 0) {
      // 아직 꺼내지 않는다: 기다리는 동안 들어온 foreground 작업이 먼저 뽑히게.
      lane.timer = setTimeout(() => {
        lane.timer = undefined;
        pump(key);
      }, wait);
      return;
    }
  }

  removeJob(lane, next);
  if (next.signal && next.onAbort) next.signal.removeEventListener('abort', next.onAbort);
  lane.running = true;

  let p: Promise<unknown>;
  try {
    p = Promise.resolve(next.run());
  } catch (e) {
    p = Promise.reject(e);
  }
  p.then(next.resolve, next.reject).finally(() => {
    lane.running = false;
    lane.lastEnd = Date.now();
    pump(key);
  });
}

/** key: 보통 연결 프로필 id */
export function enqueue<T>(key: string, job: () => Promise<T>, opts: EnqueueOptions = {}): Promise<T> {
  const { priority = 'background', minIntervalMs = 0, signal } = opts;
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const lane = getLane(key);
    const queued: QueuedJob = {
      run: job,
      resolve: resolve as (v: unknown) => void,
      reject,
      minIntervalMs: Math.max(0, minIntervalMs),
      signal,
    };
    if (signal) {
      queued.onAbort = () => {
        if (removeJob(lane, queued)) reject(abortError());
      };
      signal.addEventListener('abort', queued.onAbort, { once: true });
    }
    (priority === 'foreground' ? lane.foreground : lane.background).push(queued);
    pump(key);
  });
}

/** 키별 대기 중(실행 중 제외) 작업 수. 화면 표시용 */
export function pendingCount(key: string): number {
  const lane = lanes.get(key);
  return lane ? lane.foreground.length + lane.background.length : 0;
}

/** 키에서 지금 작업이 실행 중인지 */
export function isRunning(key: string): boolean {
  return lanes.get(key)?.running ?? false;
}

/** 테스트용: 모든 상태를 지운다 (대기 작업은 버려진다) */
export function resetQueueForTests(): void {
  for (const lane of lanes.values()) {
    if (lane.timer !== undefined) clearTimeout(lane.timer);
  }
  lanes.clear();
}
