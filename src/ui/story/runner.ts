// 다음 챕터 계획 실행기. 패널을 닫아도 계획은 계속되게 컴포넌트 밖에 둔다 (월드 runner와 같은 방식).
import { useSyncExternalStore } from 'react';
import { planNextChapter } from '../../gen/story';
import { navigate, paths } from '../router';
import { db } from '../../db';
import { addNotice, noticeFailure, resolveNotice } from '../../game/notices';
import type { Id, StoryProgress } from '../../types';

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
    const ch = await db.chapters.get(id);
    void resolveNotice(`story-plan:${worldId}`);
    await addNotice({ key: `story-plan:${worldId}`, kind: 'done', job: 'story-plan', title: `${ch?.index ?? ''}장 「${ch?.title ?? ''}」을(를) 계획했어요`, link: paths.chapter(id), worldId });
    // 스토리 패널을 보고 있으면 새 챕터를 바로 고른다 (읽기 화면이나 다른 패널이면 그대로 둔다)
    const h = location.hash.replace(/^#\/?/, '');
    if (h === 'story' || (h.startsWith('story/') && !h.endsWith('/read'))) navigate(paths.chapter(id), { replace: true });
  } catch (e) {
    if (ctrl.signal.aborted) set(worldId, { running: false, cancelled: true });
    else {
      set(worldId, { running: false, error: e instanceof Error ? e.message : String(e) });
      await noticeFailure({ key: `story-plan:${worldId}`, job: 'story-plan', title: '다음 챕터를 계획하지 못했어요', link: paths.story, worldId }, e, ctrl.signal);
    }
  } finally {
    controllers.delete(worldId);
  }
}

export function cancelPlan(worldId: Id): void {
  controllers.get(worldId)?.abort();
}

/** 어느 장면부터 열지 읽기 화면에 넘겨 주는 메모 (경로에는 담지 않는다). "처음부터"는 0. 읽기 화면을 닫을 때 지운다 */
let startAt: { chapterId: Id; beat: number } | undefined;
export function setFreshStart(chapterId: Id | undefined, beat = 0): void {
  startAt = chapterId ? { chapterId, beat } : undefined;
}
/** 정해 둔 시작 장면. 없으면 undefined (저장된 곳에서 이어 읽기) */
export function startBeat(chapterId: Id): number | undefined {
  return startAt?.chapterId === chapterId ? startAt.beat : undefined;
}

/** 패널에서 챕터를 열 때: 읽던 중이면 이어서, 안 읽었거나 다 읽었으면 처음부터 ("이어 읽기" 버튼과 같다) */
export function openChapter(chapterId: Id, p: StoryProgress | undefined, fresh = !p || !!p.clearedAt): void {
  setFreshStart(fresh ? chapterId : undefined);
  navigate(paths.read(chapterId));
}

/** 장면 목록에서 고른 장면부터 읽기 */
export function openScene(chapterId: Id, beat: number): void {
  setFreshStart(chapterId, beat);
  navigate(paths.read(chapterId));
}

// ── 자동 넘기기 속도: 1× → 1.5× → 2× → 3×. 브라우저마다 기억한다 ──
export const AUTO_SPEEDS = [1, 1.5, 2, 3] as const;
export type AutoSpeed = (typeof AUTO_SPEEDS)[number];
const SPEED_KEY = 'my-gacha.story.autoSpeed';

type KV = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): KV | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function loadAutoSpeed(s: KV | undefined = storage()): AutoSpeed {
  try {
    const v = Number(s?.getItem(SPEED_KEY));
    return AUTO_SPEEDS.find((x) => x === v) ?? 1;
  } catch {
    return 1;
  }
}

export function saveAutoSpeed(v: AutoSpeed, s: KV | undefined = storage()): void {
  try {
    s?.setItem(SPEED_KEY, String(v));
  } catch {
    // 사생활 보호 모드 등: 기억하지 못해도 그만
  }
}

export function nextAutoSpeed(v: AutoSpeed): AutoSpeed {
  return AUTO_SPEEDS[(AUTO_SPEEDS.indexOf(v) + 1) % AUTO_SPEEDS.length]!;
}

/** "1.5×" */
export function speedLabel(v: AutoSpeed): string {
  return `${v}×`;
}

/** 자동 넘기기: 다 찍은 뒤 기다리는 시간 (글자 수에 비례, 속도로 나눈다) */
export function autoDelayMs(chars: number, speed: AutoSpeed): number {
  return Math.round((1500 + Math.min(chars, 80) * 25) / speed);
}
