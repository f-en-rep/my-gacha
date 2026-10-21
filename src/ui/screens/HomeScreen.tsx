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
    { done: hasText, label: '글 생성 연결 추가', hint: 'OpenRouter, Claude, Gemini 등', href: paths.connection('new-text') },
    { done: hasImage, label: '그림 생성 연결 추가', hint: 'NovelAI 또는 PixAI', href: paths.connection('new-image') },
    { done: routed, label: '작업별 연결 정하기', hint: '구조화·문장·그림에 쓸 연결', href: paths.settings },
    { done: false, label: '연결 진단 돌려 보기', hint: '중계기가 필요한 서비스 확인', href: paths.diagnostics },
  ];

  return (
    <div className="page home">
      <section className="hero">
        <div className="hero-art" aria-hidden="true">
          <span className="hero-orb o1" />
          <span className="hero-orb o2" />
          <span className="hero-orb o3" />
        </div>
        <div className="hero-body">
          <span className="badge">1단계에서 열려요</span>
          <h1>나만의 세계, 나만의 가챠</h1>
          <p>
            세계관을 한 줄 적으면 AI가 캐릭터와 초상화를 만들어 줘요. 뽑기 확률과 천장은 코드가 계산하고, 모든 데이터는 이 브라우저 안에만 저장돼요.
          </p>
          <div className="hero-actions">
            <button className="btn btn-primary" disabled title="1단계에서 열려요">
              <Icon name="plus" size={18} /> 새 월드 만들기
            </button>
            <button className="btn" disabled title="1단계에서 열려요">
              월드 팩 가져오기
            </button>
          </div>
        </div>
      </section>

      <div className="home-grid">
        <section className="card home-currency">
          <div className="card-head">
            <h2>재화</h2>
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
              <span className="stat-label">보유 캐릭터</span>
              <span className="stat-value">0</span>
            </div>
          </div>
          <p className="muted small">재화 이름은 월드마다 정해져요 (예: 성석, 자격증).</p>
        </section>

        <section className="card home-start">
          <div className="card-head">
            <h2>시작 준비 (0단계)</h2>
            <span className="muted small">
              {steps.filter((s) => s.done).length}/{steps.length}
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

        <section className="card home-worlds">
          <div className="card-head">
            <h2>내 월드</h2>
          </div>
          <div className="world-grid">
            {[0, 1, 2].map((i) => (
              <div key={i} className="world-slot">
                <div className="skeleton-art" />
                <span>빈 슬롯</span>
              </div>
            ))}
          </div>
          <p className="muted small">월드를 만들거나 친구에게 받은 월드 팩(.zip)을 가져오면 여기에 나타나요.</p>
        </section>
      </div>
    </div>
  );
}
