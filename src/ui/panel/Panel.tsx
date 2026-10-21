import type { ReactNode } from 'react';
import { Icon } from '../Icon';
import { paths, type PanelName } from '../router';

const TABS: { name: PanelName; label: string; path: string }[] = [
  { name: 'pull', label: '뽑기', path: paths.pull },
  { name: 'characters', label: '캐릭터', path: paths.characters },
  { name: 'story', label: '스토리', path: paths.story },
  { name: 'chat', label: '대화', path: paths.chat() },
  { name: 'shop', label: '상점', path: paths.shop },
  { name: 'world', label: '월드', path: paths.world },
  { name: 'settings', label: '설정', path: paths.settings },
];

/**
 * 로비 위에 열리는 패널.
 * 좁은 화면: 아래에서 올라오는 시트. focus가 'right'면 오른쪽 페이지만(상세), 'left'면 왼쪽만, 'both'면 둘 다 위아래로.
 * 넓은 화면: 오른쪽에 펼친 책. 왼쪽·오른쪽 페이지가 나란히, 옆에 색인 탭.
 */
export function Panel({
  name,
  code,
  title,
  left,
  right,
  focus = 'both',
  back,
}: {
  name: PanelName;
  code: string;
  title: string;
  left: ReactNode;
  right: ReactNode;
  focus?: 'left' | 'right' | 'both';
  /** 좁은 화면에서 오른쪽 페이지를 보고 있을 때 돌아갈 경로 */
  back?: string;
}) {
  return (
    <div className="panel-layer">
      <a className="panel-scrim" href={'#' + paths.home} aria-label="패널 닫기" tabIndex={-1} />
      <section className="panel" data-focus={focus} aria-labelledby="panel-title">
        <span className="panel-grabber" aria-hidden="true" />
        <header className="panel-head">
          {back && focus === 'right' && (
            <a className="icon-btn panel-back" href={'#' + back} aria-label="뒤로">
              <Icon name="back" size={18} />
            </a>
          )}
          <div className="panel-head-text">
            <span className="kicker">{code}</span>
            <h1 id="panel-title">{title}</h1>
          </div>
          <a className="icon-btn panel-close" href={'#' + paths.home} aria-label="닫기">
            <Icon name="close" size={18} />
          </a>
        </header>
        <div className="book">
          <div className="book-page page-left">{left}</div>
          <div className="book-page page-right">{right}</div>
        </div>
      </section>
      <nav className="book-tabs" aria-label="패널 바꾸기">
        {TABS.map((t) => (
          <a key={t.name} href={'#' + t.path} aria-current={t.name === name ? 'page' : undefined}>
            {t.label}
          </a>
        ))}
      </nav>
    </div>
  );
}

/** 넓은 화면에서 오른쪽 페이지가 비어 있을 때 */
export function PageHint({ children }: { children: ReactNode }) {
  return <p className="page-hint">{children}</p>;
}
