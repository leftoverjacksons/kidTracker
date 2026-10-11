import { describe, expect, it } from 'vitest';
import { ageLabel, cToF, fToC, gToLbOz, lbOzToG, mlToOz, ozToMl } from './units';

describe('unit conversion', () => {
  it('round-trips volume', () => {
    expect(ozToMl(4)).toBeCloseTo(118.294, 3);
    expect(mlToOz(ozToMl(3.5))).toBeCloseTo(3.5, 10);
  });
  it('converts temperature', () => {
    expect(cToF(37)).toBeCloseTo(98.6, 5);
    expect(fToC(100.4)).toBeCloseTo(38, 5);
  });
  it('splits grams into lb + oz', () => {
    expect(gToLbOz(lbOzToG(7, 8))).toEqual({ lb: 7, oz: 8 });
    // 15.96 oz rounds up to a whole pound rather than "0 lb 16 oz"
    expect(gToLbOz(452.5)).toEqual({ lb: 1, oz: 0 });
  });
});

describe('ageLabel', () => {
  const now = new Date(2026, 9, 11); // 2026-10-11
  it('uses days, weeks, then months', () => {
    expect(ageLabel('2026-10-10', now)).toBe('1 day');
    expect(ageLabel('2026-09-20', now)).toBe('3 weeks');
    expect(ageLabel('2026-06-11', now)).toBe('4 months');
    expect(ageLabel('2026-06-12', now)).toBe('3 months');
  });
});
