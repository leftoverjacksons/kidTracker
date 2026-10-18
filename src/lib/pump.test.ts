import { describe, expect, it } from 'vitest';
import { pumpCounts } from './pump';
import type { EventRow } from './types';

const now = new Date('2026-10-18T12:00:00Z');
const p = (side: string, startH: number, mins: number | null, extra: Partial<EventRow> = {}) => ({
  type: 'pump', pump_side: side, deleted_at: null,
  started_at: new Date(now.getTime() - startH * 3_600_000).toISOString(),
  ended_at: mins == null ? null : new Date(now.getTime() - startH * 3_600_000 + mins * 60_000).toISOString(),
  ...extra,
}) as unknown as EventRow;

describe('pumpCounts', () => {
  it('counts 15+ minute sessions per side in the last 24 h, both = each side', () => {
    const c = pumpCounts([
      p('left', 1, 20), p('right', 2, 15), p('both', 3, 18),
      p('left', 4, 10),               // too short
      p('right', 25, 30),             // older than 24 h
      p('left', 5, 20, { deleted_at: '2026-10-18T00:00:00Z' }),
    ], now);
    expect(c).toEqual({ left: 2, right: 2 });
  });
  it('counts a running session once it reaches 15 minutes', () => {
    expect(pumpCounts([p('right', 0.3, null)], now)).toEqual({ left: 0, right: 1 }); // 18 min so far
    expect(pumpCounts([p('right', 0.1, null)], now)).toEqual({ left: 0, right: 0 }); // 6 min so far
  });
});
