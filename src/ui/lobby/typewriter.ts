// 대사를 한 글자씩 찍는 효과. 누르면 바로 끝까지 보여 준다. 동작 줄이기 설정이면 처음부터 다 보인다.
import { useEffect, useState } from 'react';

const MS_PER_CHAR = 38;

function reducedMotion(): boolean {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function useTypewriter(text: string): { shown: string; typing: boolean; finish: () => void } {
  const chars = Array.from(text); // 한글·이모지가 반쪽으로 잘리지 않게 글자 단위로
  const [n, setN] = useState(() => (reducedMotion() ? chars.length : 0));

  useEffect(() => {
    setN(reducedMotion() ? Array.from(text).length : 0);
  }, [text]);

  useEffect(() => {
    if (n >= chars.length) return;
    const t = window.setTimeout(() => setN((x) => x + 1), MS_PER_CHAR);
    return () => window.clearTimeout(t);
  }, [n, chars.length]);

  return { shown: chars.slice(0, n).join(''), typing: n < chars.length, finish: () => setN(chars.length) };
}
