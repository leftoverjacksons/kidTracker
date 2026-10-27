import { describe, expect, it } from 'vitest';
import { activeMs, bottleMinutes, byBrand, flowByDay, flowRate, median, timedBottles } from './bottle';
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

describe('brand comparison', () => {
  const t = (start: string, min: number, ml: number, brand: string | null) => ({ ...b(start, min, ml), bottle_brand: brand }) as EventRow;
  const ev = [t('2026-10-20T08:00:00', 10, 60, 'MAM'), t('2026-10-20T11:00:00', 20, 60, 'MAM'), t('2026-10-20T14:00:00', 15, 90, 'Comotomo'),
    t('2026-10-20T16:00:00', 0, 60, 'MAM') /* untimed: ignored */, t('2026-10-20T18:00:00', 12, 60, null)];
  it('keeps timed bottles with amounts, newest first', () => {
    const f = timedBottles(ev, new Date('2026-10-19T00:00:00'));
    expect(f.map((x) => x.brand)).toEqual(['Not set', 'Comotomo', 'MAM', 'MAM']);
  });
  it('medians per brand, in list order with "Not set" last', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    const r = byBrand(timedBottles(ev, new Date('2026-10-19T00:00:00')));
    expect(r.map((x) => [x.brand, x.feeds, x.rate, x.minutes])).toEqual([['Comotomo', 1, 6, 15], ['MAM', 2, 4.5, 15], ['Not set', 1, 5, 12]]);
  });
});

describe('pauses', () => {
  it('leave paused time out of the feed length and flow', () => {
    const e = { ...b('2026-10-20T10:00:00Z', 20, 60), paused_s: 240 } as EventRow;
    expect(bottleMinutes(e)).toBe(16);
    expect(flowRate(e)).toBe(3.75);
  });
  it('a running timer counts to now; a paused one is frozen at the pause', () => {
    const now = new Date('2026-10-20T10:10:00Z');
    expect(activeMs({ started_at: '2026-10-20T10:00:00Z', ended_at: null, paused_at: null, paused_s: 60 }, now)).toBe(9 * 60_000);
    expect(activeMs({ started_at: '2026-10-20T10:00:00Z', ended_at: null, paused_at: '2026-10-20T10:05:00Z', paused_s: 60 }, now)).toBe(4 * 60_000);
  });
});
