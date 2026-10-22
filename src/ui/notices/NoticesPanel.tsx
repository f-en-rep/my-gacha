// 알림 패널: 뒤에서 돌던 생성의 실패·완료 기록. 왼쪽은 알림 목록(최신순), 오른쪽은 무엇이 남는지와 정리 버튼.
// 패널을 열면 보이는 알림을 읽음으로 바꾸되, 이번에 처음 본 것은 "새" 표시를 남겨 둔다.
import { useEffect, useRef, useState } from 'react';
import { Panel } from '../panel/Panel';
import { Icon } from '../Icon';
import { JOB_LABEL, NOTICE_CAP, clearNotices, deleteNotice, markNoticesRead, useNotices } from '../../game/notices';
import type { Notice } from '../../types';
import './notices.css';

/** "방금", "5분 전", "어제 14:02", "10월 3일 09:15" */
export function noticeTime(iso: string, at = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sec = Math.round((at.getTime() - d.getTime()) / 1000);
  if (sec < 60) return '방금';
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  const hm = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(at) - day(d)) / 86400000);
  if (diff === 0) return `오늘 ${hm}`;
  if (diff === 1) return `어제 ${hm}`;
  return `${d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} ${hm}`;
}

const KIND_LABEL: Record<Notice['kind'], string> = { error: '실패', done: '완료', info: '안내' };

export function NoticesPanel() {
  const list = useNotices();
  // 이번에 열었을 때 안 읽었던 것 ("새" 표시용)
  const fresh = useRef(new Set<string>());
  const [, bump] = useState(0);

  useEffect(() => {
    if (!list) return;
    const unread = list.filter((n) => !n.readAt).map((n) => n.id);
    if (!unread.length) return;
    for (const id of unread) fresh.current.add(id);
    bump((v) => v + 1);
    void markNoticesRead(unread);
  }, [list]);

  const errors = list?.filter((n) => n.kind === 'error').length ?? 0;

  return (
    <Panel
      name="notices"
      code="NOTICE"
      title="알림"
      focus="both"
      left={
        <div className="stack">
          <div>
            <div className="page-section-head">
              <h2>알림</h2>
              <span className="mono muted">{list ? `${list.length}${errors ? ` · 실패 ${errors}` : ''}` : '—'}</span>
            </div>
            <NoticeTools list={list} />
            {!list ? null : list.length === 0 ? (
              <div className="hint-box nt-empty">
                <strong>알림이 없습니다</strong>
                <p className="small muted">
                  월드 생성, 스토리, 그림, 대화가 뒤에서 실패하거나 끝나면 여기에 남아요. 패널을 닫아 두었다가 놓쳐도 이유를 볼 수 있습니다.
                </p>
              </div>
            ) : (
              <ul className="nt-list">
                {list.map((n) => (
                  <NoticeRow key={n.id} n={n} fresh={fresh.current.has(n.id)} />
                ))}
              </ul>
            )}
          </div>
        </div>
      }
      right={<NoticeSide list={list} />}
    />
  );
}

function NoticeRow({ n, fresh }: { n: Notice; fresh: boolean }) {
  const [open, setOpen] = useState(false);
  const long = (n.detail?.length ?? 0) > 90;
  return (
    <li className={`nt-item nt-${n.kind}` + (fresh ? ' is-fresh' : '')}>
      <span className="nt-mark" aria-hidden="true">
        {n.kind === 'error' ? '!' : n.kind === 'done' ? '✓' : 'i'}
      </span>
      <div className="nt-body">
        <p className="nt-meta">
          <span className="nt-kind">{KIND_LABEL[n.kind]}</span>
          <span>{JOB_LABEL[n.job]}</span>
          <time className="mono" dateTime={n.updatedAt} title={new Date(n.updatedAt).toLocaleString('ko-KR')}>
            {noticeTime(n.updatedAt)}
          </time>
          {n.count > 1 && <span className="nt-count mono">×{n.count}</span>}
          {fresh && <span className="nt-new mono">NEW</span>}
        </p>
        <strong className="nt-title">{n.title}</strong>
        {n.detail && <p className={'nt-detail small' + (long && !open ? ' is-clamped' : '')}>{n.detail}</p>}
        <div className="nt-actions">
          {long && (
            <button type="button" className="nt-link" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? '접기' : '자세히'}
            </button>
          )}
          {n.link && (
            <a className="nt-link nt-go" href={'#' + n.link}>
              가 보기 <Icon name="chevron" size={14} />
            </a>
          )}
          <button type="button" className="nt-link nt-del" aria-label="이 알림 지우기" onClick={() => void deleteNotice(n.id)}>
            지우기
          </button>
        </div>
      </div>
    </li>
  );
}

function NoticeTools({ list }: { list: Notice[] | undefined }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="nt-tools">
      <button type="button" className="btn btn-small" disabled={!list?.some((n) => !n.readAt)} onClick={() => void markNoticesRead()}>
        모두 읽음
      </button>
      {confirm ? (
        <>
          <button
            type="button"
            className="btn btn-small btn-danger"
            onClick={() => {
              void clearNotices();
              setConfirm(false);
            }}
          >
            정말 모두 지우기
          </button>
          <button type="button" className="btn btn-small btn-ghost" onClick={() => setConfirm(false)}>
            그만두기
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-small btn-ghost" disabled={!list?.length} onClick={() => setConfirm(true)}>
          모두 지우기
        </button>
      )}
    </div>
  );
}

function NoticeSide({ list }: { list: Notice[] | undefined }) {
  const errors = list?.filter((n) => n.kind === 'error' && !n.readAt).length ?? 0;
  return (
    <div className="stack">
      {errors > 0 && <p className="small nt-unread">안 읽은 실패 알림 {errors}개</p>}
      <div className="hint-box">
        <strong>무엇이 남나요</strong>
        <ul className="small nt-what">
          <li>
            <b>실패</b> — 월드 생성, 챕터 계획·장면 쓰기·정리, 초상화·배경·배너 그림, 대화 답, 카드 가져오기. 같은 일이 또 실패하면 새 줄 대신 횟수(×2)가
            올라가요. 직접 멈춘 것은 남기지 않아요.
          </li>
          <li>
            <b>완료</b> — 오래 걸려 놓치기 쉬운 것만: 월드 준비, 챕터 계획, 뒤에서 그린 초상화, 배너 그림.
          </li>
          <li>다시 해서 잘 되면 그 실패 알림은 읽음으로 바뀝니다.</li>
        </ul>
        <p className="small muted">이 기기에만 남고 백업·월드 팩에는 들어가지 않습니다. 최근 {NOTICE_CAP}개까지.</p>
      </div>
    </div>
  );
}
