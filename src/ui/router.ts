// 아주 작은 해시 라우터. 로비는 늘 깔려 있고, 경로는 그 위에 열 패널을 정한다.
import { useSyncExternalStore } from 'react';
import type { LoreKind } from '../types';

const LORE_KINDS: readonly string[] = ['event', 'person', 'item'];

export type SettingsSub =
  | { kind: 'connection'; id: string }
  | { kind: 'routing' }
  | { kind: 'storage' }
  | { kind: 'diagnostics' }
  | { kind: 'prompts'; id?: string };

export type Route =
  | { name: 'home' }
  | { name: 'pull'; banner?: 'new' | { edit: string } }
  | { name: 'characters'; id?: string; mode?: 'new' | 'edit' | 'import' }
  | { name: 'world' }
  | { name: 'story'; chapterId?: string; read?: boolean }
  | { name: 'chat'; characterId?: string }
  | { name: 'shop' }
  | { name: 'archive'; kind?: LoreKind; id?: string; mode?: 'new' | 'profile' }
  | { name: 'notices' }
  | { name: 'settings'; sub?: SettingsSub };

export type PanelName = Exclude<Route['name'], 'home'>;

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [a, b, c] = parts;
  switch (a) {
    case 'pull':
      if (b === 'new') return { name: 'pull', banner: 'new' };
      if (b === 'edit' && c) return { name: 'pull', banner: { edit: c } };
      return { name: 'pull' };
    case 'chat':
      return b ? { name: 'chat', characterId: b } : { name: 'chat' };
    case 'shop':
      return { name: 'shop' };
    case 'archive':
      if (b === 'me') return { name: 'archive', mode: 'profile' };
      if (b && LORE_KINDS.includes(b)) {
        const kind = b as LoreKind;
        if (c === 'new') return { name: 'archive', kind, mode: 'new' };
        return c ? { name: 'archive', kind, id: c } : { name: 'archive', kind };
      }
      return { name: 'archive' };
    case 'notices':
      return { name: 'notices' };
    case 'story':
      if (b && c === 'read') return { name: 'story', chapterId: b, read: true };
      return b ? { name: 'story', chapterId: b } : { name: 'story' };
    case 'characters':
      if (b === 'new' || b === 'import') return { name: 'characters', mode: b };
      if (b && c === 'edit') return { name: 'characters', id: b, mode: 'edit' };
      return b ? { name: 'characters', id: b } : { name: 'characters' };
    case 'world':
      return { name: 'world' };
    case 'diagnostics':
      return { name: 'settings', sub: { kind: 'diagnostics' } };
    case 'settings':
      if (b === 'connections' && c) return { name: 'settings', sub: { kind: 'connection', id: c } };
      if (b === 'prompts') return { name: 'settings', sub: c ? { kind: 'prompts', id: c } : { kind: 'prompts' } };
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
  newCharacter: '/characters/new',
  editCharacter: (id: string) => `/characters/${encodeURIComponent(id)}/edit`,
  importCards: '/characters/import',
  world: '/world',
  newBanner: '/pull/new',
  editBanner: (id: string) => `/pull/edit/${encodeURIComponent(id)}`,
  story: '/story',
  chat: (id?: string) => (id ? `/chat/${encodeURIComponent(id)}` : '/chat'),
  shop: '/shop',
  archive: '/archive',
  loreKind: (kind: LoreKind) => `/archive/${kind}`,
  lore: (kind: LoreKind, id: string) => `/archive/${kind}/${encodeURIComponent(id)}`,
  newLore: (kind: LoreKind) => `/archive/${kind}/new`,
  playerProfile: '/archive/me',
  notices: '/notices',
  chapter: (id: string) => `/story/${encodeURIComponent(id)}`,
  read: (id: string) => `/story/${encodeURIComponent(id)}/read`,
  settings: '/settings',
  routing: '/settings/routing',
  storage: '/settings/storage',
  diagnostics: '/settings/diagnostics',
  connection: (id: string) => `/settings/connections/${encodeURIComponent(id)}`,
  prompts: '/settings/prompts',
  prompt: (id: string) => `/settings/prompts/${encodeURIComponent(id)}`,
};
