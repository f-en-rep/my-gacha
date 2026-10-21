// 아주 작은 해시 라우터: #/home, #/settings/connections/:id ...
import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'pull' }
  | { name: 'characters' }
  | { name: 'settings' }
  | { name: 'connection'; id: string }
  | { name: 'diagnostics' };

export type TabName = 'home' | 'pull' | 'characters' | 'settings';

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [a, b, c] = parts;
  switch (a) {
    case 'pull':
      return { name: 'pull' };
    case 'characters':
      return { name: 'characters' };
    case 'diagnostics':
      return { name: 'diagnostics' };
    case 'settings':
      if (b === 'connections' && c) return { name: 'connection', id: c };
      return { name: 'settings' };
    default:
      return { name: 'home' };
  }
}

/** 지금 화면이 어느 탭에 속하는지 */
export function tabOf(route: Route): TabName {
  if (route.name === 'connection' || route.name === 'diagnostics') return 'settings';
  return route.name;
}

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  const hash = '#' + path;
  if (opts.replace) {
    history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = path;
  }
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash, () => '');
  return parseHash(hash);
}

export const paths = {
  home: '/home',
  pull: '/pull',
  characters: '/characters',
  settings: '/settings',
  diagnostics: '/diagnostics',
  connection: (id: string) => `/settings/connections/${encodeURIComponent(id)}`,
};
