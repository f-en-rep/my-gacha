// 지금 플레이 중인 월드·세이브와 그 데이터를 읽고 쓰는 곳. 화면들은 여기를 거친다.
import { useEffect, useState } from 'react';
import { db, getSettings } from '../db';
import { ARKNIGHTS_RULES, type GachaRules } from '../core/gacha';
import { newId, now } from '../core/id';
import { randomSeed } from '../core/rng';
import { useLiveQuery } from '../ui/hooks';
import type { Banner, Beat, Chapter, ChatLine, Character, Id, Location, PullRecord, Save, StoryProgress, World } from '../types';

/** 새 세이브에 넣어 주는 시작 재화 (10회분) */
export const START_PULL_CURRENCY = 6000;
/** 매일 보상 (2회분) */
export const DAILY_PULL_CURRENCY = 1200;
/** 챕터를 처음 끝까지 읽었을 때 보상 (1회분) */
export const STORY_CLEAR_REWARD = 600;

export function newSave(worldId: Id, name = '기본'): Save {
  const t = now();
  return {
    id: newId('save_'),
    worldId,
    name,
    wallet: { pull: START_PULL_CURRENCY, shop: 0 },
    owned: {},
    pity: {},
    banners: {},
    freeMode: false,
    rngState: randomSeed(),
    createdAt: t,
    updatedAt: t,
  };
}

/** 월드가 가챠 수치를 덮어썼으면 반영한 규칙 */
export function rulesFor(world: World | undefined): GachaRules {
  return { ...ARKNIGHTS_RULES, ...((world?.gachaOverrides ?? {}) as Partial<GachaRules>) };
}

export interface ActiveGame {
  loading: boolean;
  world?: World;
  save?: Save;
}

/** 지금 플레이 중인 월드와 세이브. 둘 다 없으면 월드 없음 */
export function useActiveGame(): ActiveGame {
  const v = useLiveQuery(async () => {
    const s = await getSettings();
    const world = s.activeWorldId ? await db.worlds.get(s.activeWorldId) : undefined;
    const save = world && s.activeSaveId ? await db.saves.get(s.activeSaveId) : undefined;
    return { world, save: save?.worldId === world?.id ? save : undefined };
  }, []);
  return { loading: v === undefined, ...v };
}

export function useWorlds(): World[] | undefined {
  return useLiveQuery(() => db.worlds.orderBy('updatedAt').reverse().toArray(), []);
}

/** 월드 캐스트. 희귀도 높은 순, 같은 희귀도는 이름순 */
export function useCast(worldId: Id | undefined): Character[] | undefined {
  return useLiveQuery(async () => {
    if (!worldId) return [];
    const list = await db.characters.where('worldId').equals(worldId).toArray();
    return list.sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name, 'ko'));
  }, [worldId]);
}

export function useBanners(worldId: Id | undefined): Banner[] | undefined {
  return useLiveQuery(async () => {
    if (!worldId) return [];
    const list = await db.banners.where('worldId').equals(worldId).toArray();
    return list.sort((a, b) => (a.kind === b.kind ? a.createdAt.localeCompare(b.createdAt) : a.kind === 'standard' ? -1 : 1));
  }, [worldId]);
}

/** 뽑기 기록. 최신순 */
export function usePullHistory(saveId: Id | undefined, limit = 200): PullRecord[] | undefined {
  return useLiveQuery(async () => {
    if (!saveId) return [];
    const list = await db.pulls.where('saveId').equals(saveId).reverse().sortBy('id');
    return list.slice(0, limit);
  }, [saveId, limit]);
}

/** 월드의 챕터. 1장부터 */
export function useChapters(worldId: Id | undefined): Chapter[] | undefined {
  return useLiveQuery(async () => {
    if (!worldId) return [];
    return db.chapters.where('[worldId+index]').between([worldId, 0], [worldId, Infinity]).toArray();
  }, [worldId]);
}

export function useChapter(chapterId: Id | undefined): Chapter | undefined {
  return useLiveQuery(async () => (chapterId ? db.chapters.get(chapterId) : undefined), [chapterId]);
}

/** 챕터의 쓰인 장면들. 장면 순서대로 */
export function useBeats(chapterId: Id | undefined): Beat[] | undefined {
  return useLiveQuery(async () => {
    if (!chapterId) return [];
    return db.beats.where('[chapterId+index]').between([chapterId, 0], [chapterId, Infinity]).toArray();
  }, [chapterId]);
}

export function useLocations(worldId: Id | undefined): Location[] | undefined {
  return useLiveQuery(async () => (worldId ? db.locations.where('worldId').equals(worldId).toArray() : []), [worldId]);
}

/** 읽은 위치 저장 (같은 세이브를 다시 읽고 고친다) */
export async function setStoryProgress(saveId: Id, chapterId: Id, beat: number, segment: number): Promise<void> {
  await db.transaction('rw', db.saves, async () => {
    const s = await db.saves.get(saveId);
    if (!s) return;
    const prev: StoryProgress | undefined = s.story?.[chapterId];
    const next: StoryProgress = { ...prev, beat, segment };
    await db.saves.put({ ...s, story: { ...s.story, [chapterId]: next }, updatedAt: now() });
  });
}

/** 챕터를 끝까지 읽음. 처음이면 보상을 주고 true */
export async function clearChapter(saveId: Id, chapterId: Id): Promise<boolean> {
  return db.transaction('rw', db.saves, async () => {
    const s = await db.saves.get(saveId);
    if (!s) return false;
    const prev = s.story?.[chapterId];
    if (prev?.clearedAt) return false;
    const next: StoryProgress = { beat: prev?.beat ?? 0, segment: prev?.segment ?? 0, clearedAt: now() };
    await db.saves.put({
      ...s,
      wallet: { ...s.wallet, pull: s.wallet.pull + STORY_CLEAR_REWARD },
      story: { ...s.story, [chapterId]: next },
      updatedAt: now(),
    });
    return true;
  });
}

/** 캐릭터 하나와의 대화. 오래된 것부터 */
export function useChatLines(saveId: Id | undefined, characterId: Id | undefined): ChatLine[] | undefined {
  return useLiveQuery(async () => {
    if (!saveId || !characterId) return [];
    return db.chatLines.where('[saveId+characterId]').equals([saveId, characterId]).sortBy('id');
  }, [saveId, characterId]);
}

/** 저장된 그림(Asset)을 <img src>로 쓸 주소. 없거나 지워졌으면 undefined */
export function useAssetUrl(assetId: Id | undefined): string | undefined {
  const blob = useLiveQuery(async () => (assetId ? (await db.assets.get(assetId))?.blob : undefined), [assetId]);
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

/** 플레이할 월드 바꾸기. 세이브가 없으면 새로 만든다 */
export async function activateWorld(worldId: Id, saveId?: Id): Promise<Save> {
  return db.transaction('rw', db.saves, db.settings, async () => {
    let save = saveId ? await db.saves.get(saveId) : undefined;
    if (!save || save.worldId !== worldId) {
      save = (await db.saves.where('worldId').equals(worldId).reverse().sortBy('updatedAt'))[0];
    }
    if (!save) {
      save = newSave(worldId);
      await db.saves.put(save);
    }
    const cur = await getSettings();
    await db.settings.put({ ...cur, activeWorldId: worldId, activeSaveId: save.id });
    return save;
  });
}

/** 세이브와 뽑기 기록을 함께 저장 (뽑기 한 번 = 트랜잭션 하나) */
export async function commitPull(save: Save, records: PullRecord[]): Promise<void> {
  await db.transaction('rw', db.saves, db.pulls, async () => {
    await db.saves.put(save);
    if (records.length) await db.pulls.bulkAdd(records);
  });
}

export async function putSave(save: Save): Promise<void> {
  await db.saves.put({ ...save, updatedAt: now() });
}

/** 오늘 날짜 (기기 시간대, YYYY-MM-DD) */
export function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 월드와 거기 딸린 모든 것(캐릭터, 배너, 그림, 세이브, 뽑기 기록) 지우기 */
export async function deleteWorld(worldId: Id): Promise<void> {
  await db.transaction('rw', [db.worlds, db.characters, db.banners, db.assets, db.saves, db.pulls, db.settings, db.chapters, db.beats, db.locations, db.chatLines], async () => {
    const saves = await db.saves.where('worldId').equals(worldId).primaryKeys();
    for (const sid of saves) {
      await db.pulls.where('saveId').equals(sid).delete();
      await db.chatLines.where('saveId').equals(sid).delete();
    }
    await db.saves.bulkDelete(saves);
    await db.characters.where('worldId').equals(worldId).delete();
    await db.banners.where('worldId').equals(worldId).delete();
    await db.chapters.where('worldId').equals(worldId).delete();
    await db.beats.where('worldId').equals(worldId).delete();
    await db.locations.where('worldId').equals(worldId).delete();
    await db.assets.where('worldId').equals(worldId).delete();
    await db.worlds.delete(worldId);
    const s = await getSettings();
    if (s.activeWorldId === worldId) await db.settings.put({ ...s, activeWorldId: undefined, activeSaveId: undefined });
  });
}
