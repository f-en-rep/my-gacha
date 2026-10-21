// 테스트용 가짜 데이터
import type { Banner, Character, Rarity, Save } from '../../types';

export function char(id: string, rarity: Rarity): Character {
  return {
    id,
    worldId: 'w',
    name: id,
    rarity,
    tags: { position: '근거리', role: [], element: '불', trait: [] },
    appearance: '',
    imageTags: '',
    personality: '',
    background: '',
    quotes: [],
    detail: rarity >= 5 ? 'full' : 'light',
    createdAt: '',
    updatedAt: '',
  };
}

/** 6★ 4명(a6,b6,c6,d6), 5★ 4명, 4★ 4명, 3★ 4명 */
export function makeCast(): Character[] {
  const out: Character[] = [];
  for (const r of [6, 5, 4, 3] as const) for (const p of ['a', 'b', 'c', 'd']) out.push(char(`${p}${r}`, r));
  return out;
}

export function makeBanner(over: Partial<Banner> = {}): Banner {
  return {
    id: 'std1',
    worldId: 'w',
    kind: 'standard',
    name: 'b',
    featured6: ['a6'],
    featured5: ['a5'],
    createdAt: '',
    ...over,
  };
}

export function makeSave(over: Partial<Save> = {}): Save {
  return {
    id: 's',
    worldId: 'w',
    name: 's',
    wallet: { pull: 1_000_000, shop: 0 },
    owned: {},
    pity: {},
    banners: {},
    freeMode: false,
    rngState: 12345,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}
