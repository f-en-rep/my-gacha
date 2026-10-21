// 시드 고정 난수 (mulberry32). 같은 시드면 같은 결과가 나와서 테스트와 버그 재현이 쉽다.
// 상태는 숫자 하나라 Save.rngState에 그대로 저장한다.

export interface Rng {
  /** [0, 1) */
  next(): number;
  /** 현재 상태. 저장했다가 createRng(state)로 이어서 쓴다 */
  readonly state: number;
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  return {
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    get state() {
      return s;
    },
  };
}

export function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]!;
}

/** 배열에서 하나 고르기 */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick: empty list');
  return items[Math.floor(rng.next() * items.length)]!;
}
