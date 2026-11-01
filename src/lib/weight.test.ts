import { describe, expect, it } from 'vitest';
import { formatPct, gainTrend, weightChange } from './weight';

const row = (d: string, g: number | null) => ({ started_at: d, weight_g: g });

describe('weightChange', () => {
  it('measures each weight against the earliest one, in time order', () => {
    const w = weightChange([
      row('2026-10-14T10:00:00Z', 3250), // logged out of order
      row('2026-10-11T10:00:00Z', 3500), // birth weight
      row('2026-10-12T10:00:00Z', 3290),
      row('2026-10-25T10:00:00Z', 3600),
      row('2026-10-20T10:00:00Z', null),
    ])!;
    expect(w.base.grams).toBe(3500);
    expect(w.points.map((p) => Math.round(p.pct * 10) / 10)).toEqual([0, -6, -7.1, 2.9]);
    expect(w.lowest.grams).toBe(3250);
    expect(w.latest.grams).toBe(3600);
    expect(new Date(w.regainedAt!).toISOString()).toBe('2026-10-25T10:00:00.000Z');
  });
  it('handles a single weight and no weights', () => {
    const w = weightChange([row('2026-10-11T10:00:00Z', 3500)])!;
    expect(w.points).toHaveLength(1);
    expect(w.regainedAt).toBeNull();
    expect(weightChange([row('2026-10-11T10:00:00Z', null)])).toBeNull();
  });
  it('formats percentages with a true minus sign', () => {
    expect(formatPct(-6.04)).toBe('−6.0%');
    expect(formatPct(2.94)).toBe('+2.9%');
    expect(formatPct(0.01)).toBe('0%');
  });
  it('fits a line through the weights back at or above the first one', () => {
    const w = weightChange([
      row('2026-10-14T10:00:00Z', 3500), row('2026-10-17T10:00:00Z', 3290), // birth, lowest
      row('2026-10-24T10:00:00Z', 3510), row('2026-10-26T10:00:00Z', 3580), row('2026-10-30T10:00:00Z', 3700),
    ])!;
    const g = gainTrend(w)!;
    expect(g.n).toBe(3);
    expect(Math.round(g.gPerDay)).toBe(31); // 3510, 3580, 3700 on days 0, 2, 6: least squares 31.4 g/day
    expect(gainTrend(weightChange([row('2026-10-14T10:00:00Z', 3500), row('2026-10-24T10:00:00Z', 3600)])!)).toBeNull();
    // A later dip below the first weight stays in the fit.
    const dip = gainTrend(weightChange([row('2026-10-14T10:00:00Z', 3500), row('2026-10-17T10:00:00Z', 3290),
      row('2026-10-24T10:00:00Z', 3520), row('2026-10-26T10:00:00Z', 3580), row('2026-10-28T10:00:00Z', 3400)])!)!;
    expect(dip.n).toBe(3);
    expect(dip.gPerDay).toBeLessThan(0);
  });
});
