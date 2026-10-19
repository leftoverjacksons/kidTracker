import { describe, expect, it } from 'vitest';
import { pumpCounts, pumpDue } from './pump';
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

describe('pumpDue', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  const p = (startMinAgo: number, minutes: number, side: 'left' | 'right' | 'both', running = false) => ({
    type: 'pump', pump_side: side, deleted_at: null,
    started_at: new Date(now.getTime() - startMinAgo * 60_000).toISOString(),
    ended_at: running ? null : new Date(now.getTime() - (startMinAgo - minutes) * 60_000).toISOString(),
  }) as EventRow;
  it('is due one interval after the last 15+ minute session started', () => {
    const d = pumpDue([p(90, 20, 'both')], now, 120)!;
    expect(d.due.toISOString()).toBe('2026-10-20T12:30:00.000Z');
    expect(d.side).toBe('both');
  });
  it('ignores short sessions and picks the side that has waited longest', () => {
    const d = pumpDue([p(200, 20, 'left'), p(60, 20, 'right'), p(20, 5, 'left')], now, 120)!;
    expect(d.side).toBe('left');
    expect(d.due.toISOString()).toBe('2026-10-20T10:40:00.000Z'); // overdue
  });
  it('is null while pumping, when off, or with no sessions', () => {
    expect(pumpDue([p(90, 20, 'both'), p(5, 0, 'both', true)], now, 120)).toBeNull();
    expect(pumpDue([p(90, 20, 'both')], now, null)).toBeNull();
    expect(pumpDue([], now, 120)).toBeNull();
  });
});
