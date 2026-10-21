import { useMemo } from 'react';
import type { Banner, Character, Id, PullRecord } from '../../types';
import { Stars } from './art';

export const HISTORY_PAGE = 10;

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 뽑기 기록. 최신순, 10개씩 */
export function PullHistory({
  records,
  cast,
  banners,
  page,
  onPage,
  className = '',
  idSuffix,
}: {
  records: PullRecord[] | undefined;
  cast: Character[];
  banners: Banner[];
  page: number;
  onPage: (p: number) => void;
  className?: string;
  /** 같은 목록을 폰/넓은 화면에 따로 그리므로 id가 겹치지 않게 */
  idSuffix: string;
}) {
  const byId = useMemo(() => new Map<Id, Character>(cast.map((c) => [c.id, c])), [cast]);
  const bannerName = useMemo(() => new Map<Id, string>(banners.map((b) => [b.id, b.name])), [banners]);
  const list = records ?? [];
  const pages = Math.max(1, Math.ceil(list.length / HISTORY_PAGE));
  const cur = Math.min(page, pages - 1);
  const rows = list.slice(cur * HISTORY_PAGE, cur * HISTORY_PAGE + HISTORY_PAGE);
  const headId = 'pl-history-h-' + idSuffix;

  return (
    <section className={'pl-section ' + className} aria-labelledby={headId}>
      <div className="page-section-head">
        <h2 id={headId}>뽑기 기록</h2>
        <span className="mono muted">{list.length}</span>
      </div>
      {records === undefined ? null : list.length === 0 ? (
        <p className="pl-history-empty muted small">아직 뽑은 기록이 없습니다.</p>
      ) : (
        <>
          <ol className="pl-history">
            {rows.map((r) => {
              const c = byId.get(r.characterId);
              return (
                <li key={r.id ?? `${r.at}-${r.characterId}`} className="pl-history-row" data-rarity={r.rarity}>
                  <span className="pl-history-rarity">
                    <Stars rarity={r.rarity} />
                  </span>
                  <span className="pl-history-main">
                    <strong>
                      {c?.name ?? '(지워진 캐릭터)'}
                      {r.isNew && <span className="pl-new">NEW</span>}
                    </strong>
                    <small>
                      {bannerName.get(r.bannerId) ?? '배너'} · {when(r.at)}
                    </small>
                  </span>
                  <span className="pl-history-pity mono" title="이 뽑기 직전의 천장 카운터">
                    <span className="sr-only">천장 카운터 </span>
                    {r.pityBefore}
                  </span>
                </li>
              );
            })}
          </ol>
          {pages > 1 && (
            <nav className="pl-pager" aria-label="기록 페이지">
              <button type="button" className="btn btn-small btn-ghost" disabled={cur === 0} onClick={() => onPage(cur - 1)}>
                이전
              </button>
              <span className="mono" aria-live="polite">
                {cur + 1} / {pages}
              </span>
              <button type="button" className="btn btn-small btn-ghost" disabled={cur >= pages - 1} onClick={() => onPage(cur + 1)}>
                다음
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
