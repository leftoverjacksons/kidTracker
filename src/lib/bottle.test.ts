import { describe, expect, it } from 'vitest';
import { bottleMinutes, flowByDay, flowRate } from './bottle';
import type { EventRow } from './types';

const b = (start: string, min: number | null, ml: number | null) => ({
  type: 'bottle', started_at: start, deleted_at: null, bottle_ml: ml,
  ended_at: min == null ? null : new Date(Date.parse(start) + min * 60_000).toISOString(),
}) as EventRow;

describe('bottle flow', () => {
  it('needs an end time of at least a minute and an amount', () => {
    expect(bottleMinutes(b('2026-10-20T10:00:00', 12, 60))).toBe(12);
    expect(bottleMinutes(b('2026-10-20T10:00:00', 0, 60))).toBeNull();   // instant (old-style) bottle
    expect(bottleMinutes(b('2026-10-20T10:00:00', null, 60))).toBeNull(); // running
    expect(flowRate(b('2026-10-20T10:00:00', 12, 60))).toBe(5);
    expect(flowRate(b('2026-10-20T10:00:00', 12, null))).toBeNull();
  });
  it('averages per day as total ml over total minutes', () => {
    const ev = [b('2026-10-20T08:00:00', 10, 60), b('2026-10-20T14:00:00', 20, 60), b('2026-10-20T18:00:00', 0, 90)];
    expect(flowByDay(ev, ['2026-10-19', '2026-10-20'])).toEqual([null, 4]);
  });
});
