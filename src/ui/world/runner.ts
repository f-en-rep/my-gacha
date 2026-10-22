// 월드 생성 실행기. 패널을 닫아도 생성은 계속되게 컴포넌트 밖에 둔다.
// 진행 상황 자체는 World.genProgress에 기록되므로, 여기는 "이 탭에서 돌고 있는지"와 마지막 결과만 안다.
import { useSyncExternalStore } from 'react';
import { generateWorld } from '../../gen/world';
import { activateWorld } from '../../game/store';
import { db } from '../../db';
import { addNotice, noticeFailure, resolveNotice } from '../../game/notices';
import type { Id } from '../../types';

export interface RunState {
  running: boolean;
  /** 마지막 실행이 실패했으면 그 메시지 */
  error?: string;
  /** 사용자가 멈췄는지 */
  cancelled?: boolean;
  /** 이 탭에서 방금 끝까지 만들었는지 (준비 완료 안내용) */
  finished?: boolean;
  /** onProgress로 바로 받은 진행 상황 (DB 기록보다 빠를 수 있다) */
  progress?: { stage: string; done: number; total: number };
}

const IDLE: RunState = { running: false };
const states = new Map<Id, RunState>();
const controllers = new Map<Id, AbortController>();
const listeners = new Set<() => void>();

function set(id: Id, s: RunState) {
  states.set(id, s);
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useRunState(id: Id | undefined): RunState {
  return useSyncExternalStore(subscribe, () => (id ? (states.get(id) ?? IDLE) : IDLE));
}

/** 생성 시작 또는 이어서. 이미 돌고 있으면 아무것도 안 한다 */
export async function startGeneration(id: Id): Promise<void> {
  if (controllers.has(id)) return;
  const ctrl = new AbortController();
  controllers.set(id, ctrl);
  set(id, { running: true });
  try {
    await generateWorld(id, {
      signal: ctrl.signal,
      onProgress: (stage, done, total) => set(id, { running: true, progress: { stage, done, total } }),
    });
    await activateWorld(id);
    set(id, { running: false, finished: true });
    const w = await db.worlds.get(id);
    void resolveNotice(`world:${id}`);
    await addNotice({ key: `world:${id}`, kind: 'done', job: 'world', title: `「${w?.name || '새 월드'}」 월드가 준비됐어요`, link: `/world/${encodeURIComponent(id)}`, worldId: id });
  } catch (e) {
    if (ctrl.signal.aborted) set(id, { running: false, cancelled: true });
    else {
      set(id, { running: false, error: e instanceof Error ? e.message : String(e) });
      const w = await db.worlds.get(id).catch(() => undefined);
      const stage = w?.genProgress?.stage;
      await noticeFailure(
        { key: `world:${id}`, job: 'world', title: `「${w?.name || '새 월드'}」 생성이 멈췄어요${stage ? ` (${stage})` : ''}`, link: `/world/${encodeURIComponent(id)}`, worldId: id },
        e,
        ctrl.signal,
      );
    }
  } finally {
    controllers.delete(id);
  }
}

export function cancelGeneration(id: Id): void {
  controllers.get(id)?.abort();
}

export function isRunning(id: Id): boolean {
  return controllers.has(id);
}

let version = 0;
listeners.add(() => {
  version++;
});

/** 실행 상태가 바뀔 때마다 다시 그리게 */
export function useRunnerVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}
