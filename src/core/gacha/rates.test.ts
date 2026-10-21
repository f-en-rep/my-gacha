import { describe, expect, it } from 'vitest';
import { ARKNIGHTS_RULES as R } from './rules';
import { rarityRates, rollRarity, sixStarRate } from './rates';

describe('sixStarRate', () => {
  it('천장 전에는 기본 2%', () => {
    expect(sixStarRate(0, R)).toBeCloseTo(0.02);
    expect(sixStarRate(49, R)).toBeCloseTo(0.02); // 50번째 뽑기
  });
  it('51번째부터 +2%p씩', () => {
    expect(sixStarRate(50, R)).toBeCloseTo(0.04); // 51번째
    expect(sixStarRate(51, R)).toBeCloseTo(0.06); // 52번째
    expect(sixStarRate(60, R)).toBeCloseTo(0.24);
  });
  it('99번째에서 100%, 그 뒤로도 100%', () => {
    expect(sixStarRate(97, R)).toBeCloseTo(0.98);
    expect(sixStarRate(98, R)).toBe(1);
    expect(sixStarRate(150, R)).toBe(1);
  });
});

describe('rarityRates', () => {
  it('기본 확률', () => {
    const r = rarityRates(0, R);
    expect(r[6]).toBeCloseTo(0.02);
    expect(r[5]).toBeCloseTo(0.08);
    expect(r[4]).toBeCloseTo(0.5);
    expect(r[3]).toBeCloseTo(0.4);
  });
  it('늘어난 6★ 몫은 나머지에서 비율대로 빠지고 합은 1', () => {
    for (const s of [0, 50, 70, 98]) {
      const r = rarityRates(s, R);
      expect(r[6] + r[5] + r[4] + r[3]).toBeCloseTo(1);
      if (r[3] > 0) {
        expect(r[5] / r[3]).toBeCloseTo(0.2);
        expect(r[4] / r[3]).toBeCloseTo(1.25);
      }
    }
    const r = rarityRates(60, R); // 6★ 24%
    expect(r[5]).toBeCloseTo((0.08 * 0.76) / 0.98);
    expect(rarityRates(98, R)[3]).toBe(0);
  });
  it('rollRarity 경계', () => {
    const r = rarityRates(0, R);
    expect(rollRarity(0, r)).toBe(6);
    expect(rollRarity(0.0199, r)).toBe(6);
    expect(rollRarity(0.02, r)).toBe(5);
    expect(rollRarity(0.0999, r)).toBe(5);
    expect(rollRarity(0.1, r)).toBe(4);
    expect(rollRarity(0.6, r)).toBe(3);
    expect(rollRarity(0.9999, r)).toBe(3);
  });
});
