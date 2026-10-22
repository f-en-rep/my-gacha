import { describe, expect, it } from 'vitest';
import { autoDelayMs, loadAutoSpeed, nextAutoSpeed, saveAutoSpeed, speedLabel } from './runner';

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe('자동 넘기기 속도', () => {
  it('1 → 1.5 → 2 → 3 → 1 로 돈다', () => {
    expect(nextAutoSpeed(1)).toBe(1.5);
    expect(nextAutoSpeed(1.5)).toBe(2);
    expect(nextAutoSpeed(2)).toBe(3);
    expect(nextAutoSpeed(3)).toBe(1);
    expect(speedLabel(1.5)).toBe('1.5×');
  });

  it('저장하고 다시 읽는다. 이상한 값이나 저장소 오류면 1', () => {
    const s = mem();
    expect(loadAutoSpeed(s)).toBe(1);
    saveAutoSpeed(2, s);
    expect(loadAutoSpeed(s)).toBe(2);
    s.setItem('my-gacha.story.autoSpeed', '7');
    expect(loadAutoSpeed(s)).toBe(1);
    const broken = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('blocked');
      },
    };
    expect(loadAutoSpeed(broken)).toBe(1);
    expect(() => saveAutoSpeed(3, broken)).not.toThrow();
    expect(loadAutoSpeed(undefined)).toBe(1);
  });

  it('빠를수록 덜 기다린다', () => {
    expect(autoDelayMs(20, 1)).toBe(2000);
    expect(autoDelayMs(20, 2)).toBe(1000);
    expect(autoDelayMs(500, 1)).toBe(autoDelayMs(80, 1));
  });
});
