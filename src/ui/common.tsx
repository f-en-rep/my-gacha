import type { ReactNode } from 'react';
import { Icon } from './Icon';
import type { TestOutcome } from './connections';

/** 화면 위쪽 제목줄. back이 있으면 폰에서 뒤로 버튼을 보여 준다 */
export function PageHeader({ title, subtitle, back, actions, kicker }: { title: string; subtitle?: string; back?: string; actions?: ReactNode; kicker?: string }) {
  return (
    <header className="page-header">
      {back && (
        <a className="icon-btn back-btn" href={'#' + back} aria-label="뒤로">
          <Icon name="back" />
        </a>
      )}
      <div className="page-header-text">
        {kicker && <span className="kicker">{kicker}</span>}
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}

export function EmptyState({ title, children, badge }: { title: string; children?: ReactNode; badge?: string }) {
  return (
    <div className="empty">
      {badge && <span className="badge">{badge}</span>}
      <h2>{title}</h2>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

const STATE_LABEL: Record<TestOutcome['state'], string> = { ok: 'OK', fail: 'FAIL', pending: 'N/A' };

export function TestBadge({ outcome, running }: { outcome?: TestOutcome; running?: boolean }) {
  if (running) return <span className="pill pill-run">확인 중</span>;
  if (!outcome) return <span className="pill">—</span>;
  return (
    <span className={`pill pill-${outcome.state}`}>
      {STATE_LABEL[outcome.state]}
      {outcome.state !== 'pending' && <small> {outcome.ms}ms</small>}
    </span>
  );
}
