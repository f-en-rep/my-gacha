import { useEffect } from 'react';
import { useRoute, type Route } from './router';
import { requestPersistentStorage } from '../db';
import { Lobby } from './lobby/Lobby';
import { PullPanel } from './screens/PullScreen';
import { CharactersPanel } from './screens/CharactersScreen';
import { WorldPanel } from './screens/WorldPanel';
import { SettingsPanel } from './settings/SettingsPanel';
import { StoryPanel } from './story/StoryPanel';

function PanelFor({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return null;
    case 'pull':
      return <PullPanel banner={route.banner} />;
    case 'characters':
      return <CharactersPanel id={route.id} />;
    case 'world':
      return <WorldPanel />;
    case 'story':
      return <StoryPanel chapterId={route.chapterId} read={route.read} />;
    case 'settings':
      return <SettingsPanel sub={route.sub} />;
  }
}

export function App() {
  const route = useRoute();
  const open = route.name !== 'home';

  useEffect(() => {
    void requestPersistentStorage();
  }, []);

  // 패널이 열려 있으면 뒤의 로비가 스크롤되지 않게
  useEffect(() => {
    document.body.classList.toggle('panel-open', open);
  }, [open]);

  return (
    <div className="app" data-panel={open ? route.name : undefined}>
      <Lobby panelOpen={open} />
      <PanelFor route={route} />
    </div>
  );
}
