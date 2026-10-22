// 화면에 보이는 게임 용어. 내부 값(potential 1~6)은 그대로 두고 보여 줄 때만 바꾼다.

/** 중복으로 쌓는 단계의 이름 */
export const RESONANCE_TERM = '공명';

/** potential 1~6 → "공명 0" ~ "공명 5" (처음 얻으면 0) */
export function resonanceLabel(potential: number): string {
  return `공명 ${Math.max(0, potential - 1)}`;
}
