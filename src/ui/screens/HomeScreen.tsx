import { Icon } from '../Icon';
import { useProfiles, useSettings } from '../hooks';
import { paths } from '../router';

export function HomeScreen() {
  const profiles = useProfiles() ?? [];
  const settings = useSettings();
  const hasText = profiles.some((p) => p.type === 'text');
  const hasImage = profiles.some((p) => p.type === 'image');
  const routed = !!settings.routing.structured;

  const steps = [
    { done: hasText, label: '글 연결 추가', hint: 'OpenRouter, Claude, Gemini …', href: paths.connection('new-text') },
    { done: hasImage, label: '그림 연결 추가', hint: 'NovelAI, PixAI', href: paths.connection('new-image') },
    { done: routed, label: '작업별 연결 지정', hint: '어떤 일에 어떤 모델을 쓸지', href: paths.settings },
    { done: false, label: '연결 진단', hint: '중계기가 필요한지 확인', href: paths.diagnostics },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="page home">
      <section className="home-intro">
        <div>
          <span className="kicker">NO WORLD LOADED</span>
          <h1>월드가 없습니다</h1>
          <p>세계관을 적으면 캐스트와 배너가 만들어집니다. 친구에게 받은 월드 팩을 열어도 됩니다.</p>
        </div>
        <div className="hero-actions">
          <button className="btn btn-accent" disabled title="1단계에서 열립니다">
            <Icon name="plus" size={18} /> 새 월드
          </button>
          <button className="btn" disabled title="1단계에서 열립니다">
            월드 팩 열기
          </button>
        </div>
      </section>

      <div className="home-grid">
        <section className="card home-worlds">
          <div className="card-head">
            <h2>내 월드</h2>
            <span className="mono muted">0</span>
          </div>
          <div className="world-grid">
            {[0, 1, 2].map((i) => (
              <div key={i} className="world-slot">
                <div className="skeleton-art" />
                <span>빈 슬롯</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card home-start">
          <div className="card-head">
            <h2>시작 전에</h2>
            <span className="mono muted">
              {doneCount}/{steps.length}
            </span>
          </div>
          <ol className="checklist">
            {steps.map((s) => (
              <li key={s.label}>
                <a href={'#' + s.href} className={s.done ? 'done' : ''}>
                  <span className="check" aria-hidden="true">{s.done ? '✓' : ''}</span>
                  <span className="checklist-text">
                    <strong>{s.label}</strong>
                    <small>{s.hint}</small>
                  </span>
                  <Icon name="chevron" size={18} />
                </a>
              </li>
            ))}
          </ol>
        </section>

        <section className="card home-currency">
          <div className="card-head">
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
        </section>
      </div>
    </div>
  );
}
