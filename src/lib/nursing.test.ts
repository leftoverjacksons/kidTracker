import { describe, expect, it } from 'vitest';
import { activeSide, lastSide, manualSegments, sideTotals } from './nursing';
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
