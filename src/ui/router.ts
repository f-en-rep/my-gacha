// 아주 작은 해시 라우터. 로비는 늘 깔려 있고, 경로는 그 위에 열 패널을 정한다.
import { useSyncExternalStore } from 'react';

export type SettingsSub = { kind: 'connection'; id: string } | { kind: 'routing' } | { kind: 'storage' } | { kind: 'diagnostics' };

export type Route =
  | { name: 'home' }
  | { name: 'pull' }
  | { name: 'characters'; id?: string }
  | { name: 'world' }
  | { name: 'settings'; sub?: SettingsSub };

export type PanelName = Exclude<Route['name'], 'home'>;

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [a, b, c] = parts;
  switch (a) {
    case 'pull':
      return { name: 'pull' };
    case 'characters':
      return b ? { name: 'characters', id: b } : { name: 'characters' };
    case 'world':
      return { name: 'world' };
    case 'diagnostics':
      return { name: 'settings', sub: { kind: 'diagnostics' } };
    case 'settings':
      if (b === 'connections' && c) return { name: 'settings', sub: { kind: 'connection', id: c } };
      if (b === 'routing' || b === 'storage' || b === 'diagnostics') return { name: 'settings', sub: { kind: b } };
      return { name: 'settings' };
    default:
      return { name: 'home' };
  }
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
  character: (id: string) => `/characters/${encodeURIComponent(id)}`,
  world: '/world',
  settings: '/settings',
  routing: '/settings/routing',
  storage: '/settings/storage',
  diagnostics: '/settings/diagnostics',
  connection: (id: string) => `/settings/connections/${encodeURIComponent(id)}`,
};
