import { describe, expect, it } from 'vitest';
import { formatPct, weightChange } from './weight';

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
});
