import { PageHeader, EmptyState } from '../common';

export function PullScreen() {
  return (
    <div className="page">
      <PageHeader title="뽑기" subtitle="배너를 골라 1회 또는 10회 뽑기" />
      <div className="split">
        <aside className="split-list">
          <div className="banner-list">
            {['상시 배너', '한정 배너'].map((b) => (
              <div key={b} className="banner-slot">
                <div className="skeleton-art wide" />
                <div>
                  <strong>{b}</strong>
                  <small className="muted">1단계에서 열려요</small>
                </div>
              </div>
            ))}
          </div>
        </aside>
        <div className="split-detail">
          <div className="banner-stage">
            <EmptyState icon="pull" title="아직 배너가 없어요" badge="1단계">
              <p>월드를 만들면 배너가 생겨요. 확률과 천장(50회부터 6★ 확률 상승)은 코드가 계산하고, AI에게 결과를 묻지 않아요.</p>
            </EmptyState>
          </div>
          <div className="pull-preview" aria-label="10연차 결과 자리">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="pull-card" />
            ))}
          </div>
          <div className="pull-actions">
            <button className="btn" disabled>
              1회 뽑기
            </button>
            <button className="btn btn-primary" disabled>
              10회 뽑기
            </button>
            <span className="muted small">천장 0 / 50</span>
          </div>
        </div>
      </div>
    </div>
  );
}
