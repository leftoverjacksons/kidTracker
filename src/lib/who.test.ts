import { describe, expect, it } from 'vitest';
import { lmsAt, percentile, valueAtZ, chartMonths, ordinal, weightGuard } from './who';

describe('WHO growth standards', () => {
  it('median boy weight at birth is 3.3464 kg (published M)', () => {
    expect(lmsAt('male', 'weight', 0)?.[1]).toBeCloseTo(3.3464, 4);
    expect(percentile('male', 'weight', 0, 3.3464)).toBeCloseTo(50, 1);
  });
  it('reproduces published percentile values', () => {
    // Girls weight-for-age, 24 months: 5th = 9.416516, 95th = 14.16181 (CDC/WHO table)
    const lms = lmsAt('female', 'weight', 24)!;
    expect(valueAtZ(lms, -1.6449)).toBeCloseTo(9.4165, 2);
    expect(valueAtZ(lms, 1.6449)).toBeCloseTo(14.1618, 2);
    expect(percentile('female', 'weight', 24, 9.416516)).toBeCloseTo(5, 0);
  });
  it('interpolates between months and rejects ages outside 0–24', () => {
    const a = lmsAt('male', 'length', 1)![1], b = lmsAt('male', 'length', 2)![1];
    expect(lmsAt('male', 'length', 1.5)![1]).toBeCloseTo((a + b) / 2, 6);
    expect(percentile('male', 'head', 25, 45)).toBeNull();
    expect(percentile('male', 'head', -0.1, 35)).toBeNull();
  });
});

describe('growth chart window and rapid-gain guard', () => {
  it('puts today three quarters of the way across', () => {
    expect(chartMonths(0.9)).toBeCloseTo(1.2);
    expect(chartMonths(30)).toBe(24);
  });
  const D = 1 / 30.4375;
  const pts = [{ months: 0.6 * D, value: 3.74 }, { months: 1.6 * D, value: 3.55 }, { months: 3 * D, value: 3.43 }, { months: 14 * D, value: 3.75 }, { months: 25 * D, value: 4.34 }];
  it('band is the reference weight z ± 0.67', () => {
    const g = weightGuard('male', pts, 'birth');
    if ('missing' in g) throw new Error('missing');
    expect(g.hi - g.lo).toBeCloseTo(1.34);
    expect(g.z0).toBeGreaterThan(0.5); // he was born near the 78th percentile
    expect(g.change).toBeLessThan(0); // now lower on the chart than at birth
  });
  it('24-hour weight: closest to a day after the birth weight; 2 weeks: closest to day 14', () => {
    const h = weightGuard('male', pts, '24h'), w = weightGuard('male', pts, '2w');
    if ('missing' in h || 'missing' in w) throw new Error('missing');
    expect(h.ref.value).toBe(3.55);
    expect(w.ref.value).toBe(3.75);
    expect(h.z0).toBeLessThan((weightGuard('male', pts, 'birth') as { z0: number }).z0); // the fluid-inflated birth weight sits higher
  });
  it('says which weight is missing', () => {
    expect(weightGuard('male', [pts[0], pts[2]], '24h')).toEqual({ missing: '24h' }); // nothing 12–48 h after birth
    expect(weightGuard('male', [{ months: 0.5, value: 4 }], 'birth')).toEqual({ missing: 'birth' });
  });
});

it('ordinals', () => {
  expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 50, 97].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '50th', '97th']);
});
