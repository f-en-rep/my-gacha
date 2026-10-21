// 월드 패널 조각들이 같이 쓰는 것
import { useSyncExternalStore } from 'react';
import { db } from '../../db';
import { useLiveQuery, useProfiles, useSettings } from '../hooks';
import { paths } from '../router';
import type { Id, Rarity, World } from '../../types';
import type { RunState } from './runner';

/** 월드 패널 안의 하위 상태는 해시 뒤쪽에 둔다: #/world/new, #/world/<id> (라우터는 둘 다 'world'로 읽는다) */
export type WorldSub = { kind: 'none' } | { kind: 'new' } | { kind: 'world'; id: Id };

export const worldPaths = {
  root: paths.world,
  new: `${paths.world}/new`,
  of: (id: Id) => `${paths.world}/${encodeURIComponent(id)}`,
};

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function useWorldSub(): WorldSub {
  const hash = useSyncExternalStore(subscribe, () => location.hash, () => '');
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] !== 'world' || !parts[1]) return { kind: 'none' };
  if (parts[1] === 'new') return { kind: 'new' };
  return { kind: 'world', id: decodeURIComponent(parts[1]) };
}

/** 구조화 작업(JSON)에 글 연결이 지정되어 있는지. undefined면 아직 읽는 중 */
export function useTextReady(): { ready: boolean; hasProfile: boolean } | undefined {
  const profiles = useProfiles();
  const settings = useSettings();
  if (!profiles) return undefined;
  const id = settings.routing.structured;
  return {
    ready: !!id && profiles.some((p) => p.id === id && p.type === 'text'),
    hasProfile: profiles.some((p) => p.type === 'text'),
  };
}

export function NeedTextConnection({ hasProfile }: { hasProfile: boolean }) {
  return (
    <div className="hint-box hint-strong">
      <strong>글 연결이 필요합니다</strong>
      <p className="small muted">
        {hasProfile
          ? '월드를 만들려면 "작업별 연결"에서 구조화 작업에 쓸 글 연결을 지정하세요.'
          : '월드를 만들려면 먼저 OpenRouter, Claude, Gemini 같은 글 연결을 추가하세요.'}{' '}
        <a href={'#' + (hasProfile ? paths.routing : paths.settings)}>설정으로 가기</a>
      </p>
    </div>
  );
}

export function worldName(w: Pick<World, 'name'>): string {
  return w.name.trim() || '이름 없는 월드';
}

export const LANGUAGES: { value: string; label: string }[] = [
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
];

export function languageLabel(code: string): string {
  return LANGUAGES.find((l) => l.value === code)?.label ?? code;
}

/** 상태 표시 */
export function WorldStatusPill({ world, run }: { world: World; run: RunState }) {
  if (world.status === 'ready') return <span className="pill pill-ok">준비됨</span>;
  if (run.running) return <span className="pill pill-run">생성 중</span>;
  if (run.error || world.genProgress?.error) return <span className="pill pill-fail">실패</span>;
  if (world.status === 'generating') return <span className="pill pill-pending">멈춤</span>;
  return <span className="pill">입력만</span>;
}

export type RarityCounts = Record<Rarity, number> & { total: number };

export function useCastCounts(worldId: Id | undefined): RarityCounts | undefined {
  return useLiveQuery(async () => {
    const c: RarityCounts = { 6: 0, 5: 0, 4: 0, 3: 0, total: 0 };
    if (!worldId) return c;
    await db.characters
      .where('worldId')
      .equals(worldId)
      .each((ch) => {
        c[ch.rarity]++;
        c.total++;
      });
    return c;
  }, [worldId]);
}

/** 브라우저 다운로드 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
