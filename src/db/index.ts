import Dexie, { type Table } from 'dexie';
import type { AppSettings, Asset, Banner, Beat, Chapter, Character, ConnectionProfile, Location, PullRecord, Save, World } from '../types';

// 브라우저 저장소 (IndexedDB). 표 하나가 데이터 종류 하나.
export class GachaDB extends Dexie {
  worlds!: Table<World, string>;
  characters!: Table<Character, string>;
  banners!: Table<Banner, string>;
  saves!: Table<Save, string>;
  assets!: Table<Asset, string>;
  profiles!: Table<ConnectionProfile, string>;
  settings!: Table<AppSettings, string>;
  pulls!: Table<PullRecord, number>;
  chapters!: Table<Chapter, string>;
  beats!: Table<Beat, string>;
  locations!: Table<Location, string>;

  constructor(name = 'my-gacha') {
    super(name);
    this.version(1).stores({
      worlds: 'id, updatedAt',
      characters: 'id, worldId, rarity',
      banners: 'id, worldId',
      saves: 'id, worldId, updatedAt',
      assets: 'id, worldId',
      profiles: 'id, type',
      settings: 'id',
    });
    // 2: 뽑기 기록
    this.version(2).stores({
      pulls: '++id, saveId, [saveId+bannerId], at',
    });
    // 3: 스토리
    this.version(3).stores({
      chapters: 'id, worldId, [worldId+index]',
      beats: 'id, worldId, chapterId, [chapterId+index]',
      locations: 'id, worldId',
    });
  }
}

export const db = new GachaDB();

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'app',
  routing: {},
  autoPaintLowRarity: false,
};

export async function getSettings(): Promise<AppSettings> {
  return (await db.settings.get('app')) ?? DEFAULT_SETTINGS;
}

/** iPhone Safari 등에서 데이터가 지워지지 않게 저장 공간 유지를 요청 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
