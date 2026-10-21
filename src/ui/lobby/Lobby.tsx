import { Icon } from '../Icon';
import { useSetupSteps } from '../setup';
import { paths } from '../router';

function Figure() {
  return (
    <svg className="lobby-figure" viewBox="0 0 150 300" aria-hidden="true">
      <circle cx="75" cy="52" r="34" />
      <path d="M20 300 C20 180 35 112 75 104 C115 112 130 180 130 300 Z" />
    </svg>
  );
}

export function Lobby({ panelOpen }: { panelOpen: boolean }) {
  const steps = useSetupSteps();
  const required = steps.filter((s) => !s.optional);
  const next = required.find((s) => !s.done);
  const done = required.filter((s) => s.done).length;
  const noImage = steps.some((s) => s.optional && !s.done);

  return (
    <div className="lobby" aria-hidden={panelOpen || undefined}>
      <div className="lobby-floor" aria-hidden="true" />

      <header className="lobby-hud">
        <span className="brand-mark" aria-hidden="true" />
        <div className="hud-world">
          <span className="kicker">WORLD</span>
          <strong>월드 없음</strong>
        </div>
        <div className="hud-currency">
          <span className="currency currency-pull">
            <i aria-hidden="true" />
            뽑기 재화 <b>—</b>
          </span>
          <span className="currency">
            <i aria-hidden="true" />
            상점 재화 <b>—</b>
          </span>
        </div>
        <a className="icon-btn hud-settings" href={'#' + paths.settings} aria-label="설정">
          <Icon name="gear" size={20} />
        </a>
      </header>

      <div className="lobby-stage">
        <div className="stage-frame">
          <div className="stage-motif" aria-hidden="true" />
          <div className="stage-art">
            <Figure />
            <span className="stage-caption">대표 캐릭터 자리</span>
          </div>
        </div>
      </div>

      <div className="lobby-dialog" role="status">
        <span className="dialog-name">{next ? '안내' : '준비 완료'}</span>
        {next ? (
          <p>
            시작 전에 ({done}/{required.length}) — {next.label}부터 해 주세요.{' '}
            <a href={'#' + next.href}>바로 가기</a>
          </p>
        ) : (
          <p>
            연결은 끝났습니다. 다음 업데이트에서 첫 월드를 만들 수 있어요.
            {noImage && ' 그림 연결은 나중에 해도 됩니다. 그때까지 초상화는 빈 칸으로 나와요.'}
          </p>
        )}
        <span className="dialog-cursor" aria-hidden="true">
          ▼
        </span>
      </div>

      <nav className="lobby-menu" aria-label="주 메뉴">
        <a className="menu-pull" href={'#' + paths.pull}>
          <span>
            <span className="kicker">HEADHUNT</span>
            <strong>뽑기</strong>
          </span>
          <span className="mono">PITY 0/50 →</span>
        </a>
        <a href={'#' + paths.characters}>
          <strong>캐릭터</strong>
          <span className="kicker">OPERATORS</span>
        </a>
        <span className="menu-locked" aria-disabled="true">
          <strong>스토리</strong>
          <span className="kicker">PHASE 3</span>
        </span>
        <a href={'#' + paths.world}>
          <strong>월드</strong>
          <span className="kicker">WORLD</span>
        </a>
      </nav>
    </div>
  );
}
