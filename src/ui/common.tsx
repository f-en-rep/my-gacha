import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import type { TestOutcome } from './connections';

/** 화면 위쪽 제목줄. back이 있으면 폰에서 뒤로 버튼을 보여 준다 */
export function PageHeader({ title, subtitle, back, actions }: { title: string; subtitle?: string; back?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      {back && (
        <a className="icon-btn back-btn" href={'#' + back} aria-label="뒤로">
          <Icon name="back" />
        </a>
      )}
      <div className="page-header-text">
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon, title, children, badge }: { icon: IconName; title: string; children?: ReactNode; badge?: string }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={34} />
      </div>
      {badge && <span className="badge">{badge}</span>}
      <h2>{title}</h2>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function Section({ title, icon, children, aside }: { title: string; icon?: IconName; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>
          {icon && <Icon name={icon} size={20} />} {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

const STATE_LABEL: Record<TestOutcome['state'], string> = { ok: '성공', fail: '실패', pending: '준비 중' };

export function TestBadge({ outcome, running }: { outcome?: TestOutcome; running?: boolean }) {
  if (running) return <span className="pill pill-run">확인 중…</span>;
  if (!outcome) return <span className="pill">-</span>;
  return (
    <span className={`pill pill-${outcome.state}`}>
      {STATE_LABEL[outcome.state]}
      {outcome.state !== 'pending' && <small> {outcome.ms}ms</small>}
    </span>
  );
}
