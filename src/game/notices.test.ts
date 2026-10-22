import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { NOTICE_CAP, addNotice, clearNotices, isAbort, markNoticesRead, noticeFailure, resolveNotice } from './notices';

const base = { key: 'portrait:c1', job: 'portrait' as const, title: '초상화를 그리지 못했어요' };

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('알림', () => {
  it('안 읽은 같은 알림은 한 줄로 합치고 횟수·시각·글을 고친다', async () => {
    await noticeFailure(base, new Error('첫 오류'));
    await new Promise((r) => setTimeout(r, 2));
    await noticeFailure(base, new Error('둘째 오류'));
    const list = await db.notices.toArray();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ count: 2, detail: '둘째 오류', kind: 'error' });
    expect(list[0]!.updatedAt > list[0]!.createdAt).toBe(true);
    // 다른 종류(완료)는 따로
    await addNotice({ ...base, kind: 'done', title: '다 그렸어요' });
    expect(await db.notices.count()).toBe(2);
  });

  it('읽은 뒤 다시 나면 새로 쌓는다', async () => {
    await noticeFailure(base, new Error('a'));
    await markNoticesRead();
    await noticeFailure(base, new Error('b'));
    const list = await db.notices.toArray();
    expect(list).toHaveLength(2);
    expect(list.filter((n) => !n.readAt)).toHaveLength(1);
  });

  it('멈춘 것(abort)은 실패가 아니다', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await noticeFailure(base, new Error('x'), ctrl.signal);
    await noticeFailure(base, new DOMException('취소', 'AbortError'));
    expect(await db.notices.count()).toBe(0);
    expect(isAbort(new Error('x'))).toBe(false);
  });

  it(`최근 ${NOTICE_CAP}개만 남긴다`, async () => {
    for (let i = 0; i < NOTICE_CAP + 5; i++) await addNotice({ ...base, key: `k${i}`, kind: 'info' });
    expect(await db.notices.count()).toBe(NOTICE_CAP);
    const keys = new Set((await db.notices.toArray()).map((n) => n.key));
    expect(keys.has('k0')).toBe(false);
    expect(keys.has(`k${NOTICE_CAP + 4}`)).toBe(true);
  });

  it('읽음 표시, 잘 되면 실패 알림 정리, 지우기', async () => {
    const a = await addNotice({ ...base, key: 'a', kind: 'error' });
    const b = await addNotice({ ...base, key: 'b', kind: 'error' });
    await markNoticesRead([a!]);
    expect((await db.notices.get(a!))!.readAt).toBeTruthy();
    expect((await db.notices.get(b!))!.readAt).toBeUndefined();
    await resolveNotice('b');
    expect((await db.notices.get(b!))!.readAt).toBeTruthy();
    await clearNotices();
    expect(await db.notices.count()).toBe(0);
  });
});
