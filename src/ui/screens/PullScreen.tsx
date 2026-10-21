import { PageHeader, EmptyState } from '../common';

export function PullScreen() {
  return (
    <div className="page">
      <PageHeader kicker="HEADHUNT" title="뽑기" />
      <div className="split">
        <aside className="split-list">
          <div className="banner-list">
            {[
              ['상시', 'STANDARD'],
              ['한정', 'LIMITED'],
            ].map(([name, code]) => (
              <div key={code} className="banner-slot">
                <div className="skeleton-art wide" />
                <div>
                  <strong>{name} 배너</strong>
                  <small className="mono muted">{code}</small>
                </div>
              </div>
            ))}
          </div>
        </aside>
        <div className="split-detail">
          <EmptyState title="열린 배너가 없습니다" badge="PHASE 1">
            <p>월드를 만들면 상시 배너가 열립니다. 6★ 기본 2%, 50회 이후 회당 +2%.</p>
          </EmptyState>
          <div className="pull-preview" aria-label="10회 결과 자리">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="pull-card" />
            ))}
          </div>
          <div className="pull-actions">
            <span className="pity mono muted">PITY 0 / 50</span>
            <button className="btn" disabled>
              1회
            </button>
            <button className="btn btn-accent" disabled>
              10회
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
