import { Icon } from '../Icon';
import { useSetupSteps } from '../lobby/Lobby';
import { Panel } from '../panel/Panel';

const WORLD_MENU = [
  { label: '월드 정보', hint: '세계관, 시나리오, 작가 지시문' },
  { label: '배너 관리', hint: '상시·한정 배너' },
  { label: '캐스트 편집', hint: '캐릭터 추가·수정' },
  { label: '월드 팩 내보내기', hint: '친구에게 보낼 .zip' },
];

export function WorldPanel() {
  const steps = useSetupSteps();
  const required = steps.filter((s) => !s.optional);
  const done = required.filter((s) => s.done).length;

  return (
    <Panel
      name="world"
      code="WORLD"
      title="월드"
      left={
        <div className="stack">
          <div className="world-actions">
            <button className="btn btn-accent" disabled title="1단계에서 열립니다">
              <Icon name="plus" size={18} /> 새 월드
            </button>
            <button className="btn" disabled title="1단계에서 열립니다">
              월드 팩 열기
            </button>
          </div>
          <ul className="menu-list">
            {WORLD_MENU.map((m) => (
              <li key={m.label}>
                <span className="menu-row" aria-disabled="true">
                  <span className="menu-row-text">
                    <strong>{m.label}</strong>
                    <small>{m.hint}</small>
                  </span>
                  <span className="mono muted">PHASE 1</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      }
      right={
        <div className="stack">
          <div className="page-section-head">
            <h2>시작 전에</h2>
            <span className="mono muted">
              {done}/{required.length}
            </span>
          </div>
          <ol className="checklist">
            {steps.map((s) => (
              <li key={s.label}>
                <a href={'#' + s.href} className={s.done ? 'done' : ''}>
                  <span className="check" aria-hidden="true">
                    {s.done ? '✓' : ''}
                  </span>
                  <span className="checklist-text">
                    <strong>
                      {s.label}
                      {s.optional && <span className="tag-optional">선택</span>}
                    </strong>
                    <small>{s.hint}</small>
                  </span>
                  <Icon name="chevron" size={18} />
                </a>
              </li>
            ))}
          </ol>
          <div className="page-section-head">
            <h2>보유</h2>
          </div>
          <div className="stat-row">
            <div className="stat">
              <span className="stat-label">뽑기 재화</span>
              <span className="stat-value">—</span>
            </div>
            <div className="stat">
              <span className="stat-label">상점 재화</span>
              <span className="stat-value">—</span>
            </div>
            <div className="stat">
              <span className="stat-label">캐릭터</span>
              <span className="stat-value">0</span>
            </div>
          </div>
        </div>
      }
    />
  );
}
