// 화면에 보이는 게임 용어. 내부 값(potential 1~6)은 그대로 두고 보여 줄 때만 바꾼다.

/** 중복으로 쌓는 단계의 이름 */
export const BREAK_TERM = '한계 돌파';

/** potential 1~6 → "돌파 0" ~ "돌파 5" (처음 얻으면 0) */
export function breakLabel(potential: number): string {
  return `돌파 ${Math.max(0, potential - 1)}`;
}
