// 다음 챕터 계획 실행기. 패널을 닫아도 계획은 계속되게 컴포넌트 밖에 둔다 (월드 runner와 같은 방식).
import { useSyncExternalStore } from 'react';
import { planNextChapter } from '../../gen/story';
import { navigate, paths } from '../router';
import type { Id } from '../../types';

export interface PlanState {
  running: boolean;
  /** onProgress로 받은 지금 단계 */
  stage?: string;
  error?: string;
  cancelled?: boolean;
  /** 방금 만든 챕터 */
  chapterId?: Id;
}

const IDLE: PlanState = { running: false };
const states = new Map<Id, PlanState>();
const controllers = new Map<Id, AbortController>();
const listeners = new Set<() => void>();

function set(worldId: Id, s: PlanState) {
  states.set(worldId, s);
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function usePlanState(worldId: Id | undefined): PlanState {
  return useSyncExternalStore(subscribe, () => (worldId ? (states.get(worldId) ?? IDLE) : IDLE));
}

/** 다음 챕터 계획 시작. 이미 돌고 있으면 아무것도 안 한다 */
export async function startPlan(worldId: Id): Promise<void> {
  if (controllers.has(worldId)) return;
  const ctrl = new AbortController();
  controllers.set(worldId, ctrl);
  set(worldId, { running: true, stage: '챕터 계획 준비 중' });
  try {
    const id = await planNextChapter(worldId, {
      signal: ctrl.signal,
      onProgress: (stage) => set(worldId, { running: true, stage }),
    });
    set(worldId, { running: false, chapterId: id });
    // 스토리 패널을 보고 있으면 새 챕터를 바로 고른다 (읽기 화면이나 다른 패널이면 그대로 둔다)
    const h = location.hash.replace(/^#\/?/, '');
    if (h === 'story' || (h.startsWith('story/') && !h.endsWith('/read'))) navigate(paths.chapter(id), { replace: true });
  } catch (e) {
    if (ctrl.signal.aborted) set(worldId, { running: false, cancelled: true });
    else set(worldId, { running: false, error: e instanceof Error ? e.message : String(e) });
  } finally {
    controllers.delete(worldId);
  }
}

export function cancelPlan(worldId: Id): void {
  controllers.get(worldId)?.abort();
}

/** "처음부터"로 열었는지 읽기 화면에 넘겨 주는 메모 (경로에는 담지 않는다). 읽기 화면을 닫을 때 지운다 */
let freshStart: Id | undefined;
export function setFreshStart(chapterId: Id | undefined): void {
  freshStart = chapterId;
}
export function isFreshStart(chapterId: Id): boolean {
  return freshStart === chapterId;
}
