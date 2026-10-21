import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db, DEFAULT_SETTINGS } from '../db';
import type { AppSettings, ConnectionProfile } from '../types';

/** Dexie liveQuery를 React 상태로. 첫 결과 전에는 undefined */
export function useLiveQuery<T>(query: () => Promise<T>, deps: readonly unknown[]): T | undefined {
  const [value, setValue] = useState<{ v: T } | undefined>(undefined);
  useEffect(() => {
    const sub = liveQuery(query).subscribe({
      next: (v) => setValue({ v }),
      error: (e) => console.error('liveQuery 실패', e),
    });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value?.v;
}

export function useProfiles(): ConnectionProfile[] | undefined {
  return useLiveQuery(async () => {
    const all = await db.profiles.toArray();
    return all.sort((a, b) => (a.type === b.type ? a.label.localeCompare(b.label, 'ko') : a.type === 'text' ? -1 : 1));
  }, []);
}

export function useSettings(): AppSettings {
  return useLiveQuery(async () => (await db.settings.get('app')) ?? DEFAULT_SETTINGS, []) ?? DEFAULT_SETTINGS;
}

export async function updateSettings(patch: (s: AppSettings) => AppSettings): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const cur = (await db.settings.get('app')) ?? DEFAULT_SETTINGS;
    await db.settings.put(patch(cur));
  });
}
