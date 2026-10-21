// 그림이 없을 때 쓰는 기본 카드 그림 (public/cards). 희귀도별 앞면·뒷면, 미보유용 검은 카드.
import type { Rarity } from '../types';

const base = import.meta.env.BASE_URL + 'cards/';

export const cardFront = (rarity: Rarity) => `${base}front-${rarity}.webp`;
export const cardBack = (rarity: Rarity) => `${base}back-${rarity}.webp`;
export const CARD_LOCKED = base + 'front-locked.webp';
export const CARD_BACK_COMMON = base + 'back-common.webp';
