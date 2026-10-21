import type { Id, Rarity } from './world';

/** 캐릭터에 붙는 태그. 값은 World.tags 목록 안에서만 고른다. */
export interface CharacterTags {
  position: string;
  role: string[];
  element: string;
  trait: string[];
}

/**
 * 전투 능력치. 2단계(턴제)에서 쓰지만 지금부터 자리를 잡아 둔다.
 * range, block은 나중에 디펜스 모드를 붙일 여지로 남긴 값.
 */
export interface CombatStats {
  hp: number;
  atk: number;
  def: number;
  spd: number;
  /** 사거리 칸 수 */
  range: number;
  /** 저지 수 */
  block: number;
}

export interface Character {
  id: Id;
  worldId: Id;
  name: string;
  rarity: Rarity;
  tags: CharacterTags;
  /** 외형 설명 (월드 언어의 글) */
  appearance: string;
  /** 외형에서 한 번 뽑아 고정한 그림용 영어 태그. NovelAI V4 이상에서는 캐릭터 프롬프트 슬롯에 들어간다 */
  imageTags: string;
  /** 이 캐릭터만의 네거티브 태그 (캐릭터 슬롯의 네거티브) */
  imageNegative?: string;
  personality: string;
  background: string;
  /** 대표 대사 몇 줄 */
  quotes: string[];
  /** 초상화 Asset id. 처음 뽑았을 때 그린다 */
  portraitId?: Id;
  stats?: CombatStats;
  /** "full" = 6★·5★ 자세한 시트, "light" = 3★·4★ 묶음 생성 짧은 시트 */
  detail: 'full' | 'light';
  createdAt: string;
  updatedAt: string;
}
