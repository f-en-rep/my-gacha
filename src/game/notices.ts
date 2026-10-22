// 알림 쌓기와 읽기. 뒤에서 도는 작업(월드 생성, 스토리, 그림, 대화, 카드 가져오기)이 실패하거나 끝나면 여기에 남긴다.
// - 안 읽은 같은 알림(key·kind가 같은 것)은 새로 쌓지 않고 횟수와 시각만 고친다
// - 사용자가 멈춘 것(abort)은 실패가 아니다
// - 최근 NOTICE_CAP개만 남긴다. 알림을 남기다 실패해도 원래 작업에는 영향을 주지 않는다
import { db } from '../db';
import { newId, now } from '../core/id';
import { useLiveQuery } from '../ui/hooks';
import type { Id, Notice, NoticeJob, NoticeKind } from '../types';

export const NOTICE_CAP = 200;

export interface NoticeInput {
  key: string;
  kind: NoticeKind;
  job: NoticeJob;
  title: string;
  detail?: string;
  link?: string;
  worldId?: Id;
}

/** 사용자가 멈춘 것인지 (요청 취소) */
export function isAbort(e: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return e instanceof Error ? e.name === 'AbortError' : (e as { name?: unknown } | null)?.name === 'AbortError';
}

/** 오류를 한 줄 글로 */
export function errorDetail(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return (msg || '알 수 없는 오류').slice(0, 2000);
}

/** 알림 하나 남기기 (같은 안 읽은 알림이 있으면 그것을 고친다). 남긴 알림 id */
export async function addNotice(input: NoticeInput): Promise<Id | undefined> {
  try {
    return await db.transaction('rw', db.notices, async () => {
      const t = now();
      const same = (await db.notices.where('key').equals(input.key).toArray()).find((n) => !n.readAt && n.kind === input.kind);
      if (same) {
        await db.notices.put({ ...same, ...input, count: same.count + 1, updatedAt: t });
        return same.id;
      }
      const n: Notice = { id: newId('notice_'), ...input, count: 1, createdAt: t, updatedAt: t };
      await db.notices.add(n);
      const total = await db.notices.count();
      if (total > NOTICE_CAP) {
        const old = await db.notices
          .orderBy('updatedAt')
          .limit(total - NOTICE_CAP)
          .primaryKeys();
        await db.notices.bulkDelete(old);
      }
      return n.id;
    });
  } catch (e) {
    console.warn('알림을 남기지 못했습니다', e);
    return undefined;
  }
}

/** 실패 알림. 사용자가 멈춘 것이면 남기지 않는다 */
export async function noticeFailure(input: Omit<NoticeInput, 'kind' | 'detail'>, e: unknown, signal?: AbortSignal): Promise<void> {
  if (isAbort(e, signal)) return;
  await addNotice({ ...input, kind: 'error', detail: errorDetail(e) });
}

/** 다시 해서 잘 됐으면: 같은 일의 안 읽은 실패 알림을 읽음으로 */
export async function resolveNotice(key: string): Promise<void> {
  try {
    const t = now();
    await db.notices
      .where('key')
      .equals(key)
      .filter((n) => !n.readAt && n.kind === 'error')
      .modify({ readAt: t });
  } catch {
    // 알림 정리 실패는 무시
  }
}

export async function markNoticesRead(ids?: Id[]): Promise<void> {
  const t = now();
  const q = ids ? db.notices.where('id').anyOf(ids) : db.notices.toCollection();
  await q.filter((n) => !n.readAt).modify({ readAt: t });
}

export async function clearNotices(): Promise<void> {
  await db.notices.clear();
}

export async function deleteNotice(id: Id): Promise<void> {
  await db.notices.delete(id);
}

/** 최신순 */
export function useNotices(): Notice[] | undefined {
  return useLiveQuery(() => db.notices.orderBy('updatedAt').reverse().toArray(), []);
}

export function useUnreadNotices(): number {
  return useLiveQuery(() => db.notices.filter((n) => !n.readAt).count(), []) ?? 0;
}

/** 가장 최근 알림 (토스트용) */
export function useLatestNotice(): Notice | undefined {
  return useLiveQuery(() => db.notices.orderBy('updatedAt').last(), []);
}

export const JOB_LABEL: Record<NoticeJob, string> = {
  world: '월드 생성',
  characters: '캐릭터 생성',
  banner: '배너',
  'story-plan': '챕터 계획',
  'story-beat': '장면 쓰기',
  'story-finish': '챕터 정리',
  portrait: '초상화',
  'location-art': '배경 그림',
  'banner-art': '배너 그림',
  chat: '대화',
  'card-import': '카드 가져오기',
};
