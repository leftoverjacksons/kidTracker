import { describe, expect, it } from 'vitest';
import { activeSide, lastFeedStart, lastSide, manualSegments, sideTotals } from './nursing';
import type { NursingSegment } from './types';

const seg = (side: 'left' | 'right', start: string, end: string | null): NursingSegment =>
  ({ id: start, event_id: 'e', side, started_at: start, ended_at: end });

describe('nursing', () => {
  const segs = [
    seg('left', '2026-10-11T10:00:00Z', '2026-10-11T10:08:00Z'),
    seg('right', '2026-10-11T10:08:00Z', '2026-10-11T10:14:00Z'),
    seg('left', '2026-10-11T10:16:00Z', null),
  ];
  it('sums per side, counting the open segment to now', () => {
    const t = sideTotals(segs, new Date('2026-10-11T10:19:00Z'));
    expect(t.left / 60000).toBe(11);
    expect(t.right / 60000).toBe(6);
  });
  it('active and last side', () => {
    expect(activeSide(segs)).toBe('left');
    expect(activeSide(segs.slice(0, 2))).toBeNull();
    expect(lastSide(segs.slice(0, 2))).toBe('right');
  });
  it('builds manual segments back to back', () => {
    const out = manualSegments(new Date('2026-10-11T10:00:00Z'), 10, 5, 'right');
    expect(out.map((s) => s.side)).toEqual(['right', 'left']);
    expect(out[0].ended_at.toISOString()).toBe('2026-10-11T10:05:00.000Z');
    expect(out[1].ended_at.toISOString()).toBe('2026-10-11T10:15:00.000Z');
    expect(manualSegments(new Date(), 0, 7, 'left')).toHaveLength(1);
  });
});

describe('lastFeedStart', () => {
  const n = (start: string, end: string | null) => ({ type: 'nursing', started_at: start, ended_at: end });
  it('uses the start of the last feed, joining entries less than 20 min apart', () => {
    const ev = [ // newest first
      n('2026-10-15T10:40:00Z', '2026-10-15T10:50:00Z'), // 15 min after previous end
      n('2026-10-15T10:10:00Z', '2026-10-15T10:25:00Z'), // 10 min after previous end
      n('2026-10-15T09:50:00Z', '2026-10-15T10:00:00Z'),
      n('2026-10-15T07:00:00Z', '2026-10-15T07:20:00Z'), // 2.5 h earlier: separate feed
    ];
    expect(lastFeedStart(ev)?.toISOString()).toBe('2026-10-15T09:50:00.000Z');
  });
  it('ignores running and non-nursing entries', () => {
    const ev = [n('2026-10-15T12:00:00Z', null), { type: 'bottle', started_at: '2026-10-15T11:55:00Z', ended_at: null },
      n('2026-10-15T09:00:00Z', '2026-10-15T09:20:00Z')];
    expect(lastFeedStart(ev)?.toISOString()).toBe('2026-10-15T09:00:00.000Z');
    expect(lastFeedStart([])).toBeNull();
  });
});
