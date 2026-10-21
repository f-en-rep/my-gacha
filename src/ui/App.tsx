import { useEffect } from 'react';
import { Icon, type IconName } from './Icon';
import { paths, tabOf, useRoute, type Route, type TabName } from './router';
import { requestPersistentStorage } from '../db';
import { HomeScreen } from './screens/HomeScreen';
import { PullScreen } from './screens/PullScreen';
import { CharactersScreen } from './screens/CharactersScreen';
import { SettingsScreen } from './settings/SettingsScreen';
import { DiagnosticsScreen } from './settings/DiagnosticsScreen';

const TABS: { name: TabName; label: string; icon: IconName; path: string }[] = [
  { name: 'home', label: '홈', icon: 'home', path: paths.home },
  { name: 'pull', label: '뽑기', icon: 'pull', path: paths.pull },
  { name: 'characters', label: '캐릭터', icon: 'cards', path: paths.characters },
  { name: 'settings', label: '설정', icon: 'gear', path: paths.settings },
];

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <HomeScreen />;
    case 'pull':
      return <PullScreen />;
    case 'characters':
      return <CharactersScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'connection':
      return <SettingsScreen editId={route.id} />;
    case 'diagnostics':
      return <DiagnosticsScreen />;
  }
}

export function App() {
  const route = useRoute();
  const tab = tabOf(route);

  useEffect(() => {
    void requestPersistentStorage();
  }, []);

  // 화면이 바뀌면 맨 위로
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.name]);

  return (
    <div className="app">
      <nav className="nav" aria-label="주 메뉴">
        <a className="nav-brand" href={'#' + paths.home}>
          <span className="brand-mark" aria-hidden="true">✦</span>
          <span className="brand-name">my-gacha</span>
        </a>
        <div className="nav-items">
          {TABS.map((t) => (
            <a key={t.name} className="nav-item" href={'#' + t.path} aria-current={tab === t.name ? 'page' : undefined}>
              <Icon name={t.icon} />
              <span>{t.label}</span>
            </a>
          ))}
        </div>
        <div className="nav-foot">
          <a className="nav-item nav-sub" href={'#' + paths.diagnostics} aria-current={route.name === 'diagnostics' ? 'page' : undefined}>
            <Icon name="pulse" />
            <span>연결 진단</span>
          </a>
          <p className="nav-note">0단계 · 연결 준비</p>
        </div>
      </nav>
      <main className="main" key={route.name === 'connection' ? 'settings' : route.name}>
        <Screen route={route} />
      </main>
    </div>
  );
}
