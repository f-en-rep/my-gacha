import { EmptyState } from '../common';
import { Panel } from '../panel/Panel';

export function PullPanel() {
  return (
    <Panel
      name="pull"
      code="HEADHUNT"
      title="뽑기"
      left={
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
      }
      right={
        <div className="stack">
          <EmptyState title="열린 배너가 없습니다" badge="PHASE 1">
            <p>월드를 만들면 상시 배너가 열립니다. 6★ 기본 2%, 50회 이후 회당 +2%.</p>
          </EmptyState>
          <div className="pity-box">
            <div>
              <span className="mono">PITY</span>
              <span className="mono">0 / 50</span>
            </div>
            <div className="meter">
              <span style={{ width: '0.5%' }} />
            </div>
          </div>
          <div className="pull-actions">
            <button className="btn" disabled>
              1회
            </button>
            <button className="btn btn-accent" disabled>
              10회
            </button>
          </div>
        </div>
      }
    />
  );
}
