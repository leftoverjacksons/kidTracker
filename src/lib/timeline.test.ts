import { describe, expect, it } from 'vitest';
import { columnBlocks, columnStartFor, hourTicks, snap, weekColumns } from './timeline';
import type { EventRow } from './types';

const ev = (type: string, start: Date, end: Date | null, id = Math.random().toString()) =>
  ({ id, type, started_at: start.toISOString(), ended_at: end ? end.toISOString() : null, nursing_segments: [] }) as unknown as EventRow;
const L = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m); // local Oct d

describe('timeline columns', () => {
  it('starts days at the cutoff hour', () => {
    expect(columnStartFor(L(16, 20), 19).getTime()).toBe(L(16, 19).getTime());
    expect(columnStartFor(L(16, 3), 19).getTime()).toBe(L(15, 19).getTime());
    expect(columnStartFor(L(16, 3), 0).getTime()).toBe(L(16, 0).getTime());
  });
  it('builds 7 columns ending with the current one, and pages back by weeks', () => {
    const cols = weekColumns(L(16, 3), 19);
    expect(cols).toHaveLength(7);
    expect(cols[6].start.getTime()).toBe(L(15, 19).getTime());
    expect(cols[0].start.getTime()).toBe(L(9, 19).getTime());
    expect(cols[6].end.getTime()).toBe(L(16, 19).getTime());
    expect(weekColumns(L(16, 3), 19, 1)[6].start.getTime()).toBe(L(8, 19).getTime());
  });
});

describe('timeline blocks', () => {
  const col = { start: L(15, 19), end: L(16, 19) };
  it('places and clips durations; running entries extend to now', () => {
    const sleep = ev('sleep', L(15, 17), L(15, 21)); // starts before the column
    const run = ev('sleep', L(16, 12), null);
    const b = columnBlocks([sleep, run], col, L(16, 18));
    expect(b[0].top).toBe(0);
    expect(b[0].bottom).toBeCloseTo(2 / 24);
    expect(b[0].clippedTop).toBe(true);
    expect(b[1].running).toBe(true);
    expect(b[1].bottom).toBeCloseTo(23 / 24);
  });
  it('marks overlapping duration blocks narrow, but not adjacent ones', () => {
    const s = ev('sleep', L(15, 22), L(16, 1));
    const n = ev('nursing', L(16, 0), L(16, 0, 30)); // inside the sleep
    const n2 = ev('nursing', L(16, 1), L(16, 1, 20)); // starts exactly when sleep ends
    const b = columnBlocks([s, n, n2], col, L(16, 18));
    expect(b.find((x) => x.event === n)!.narrow).toBe(true);
    expect(b.find((x) => x.event === n2)!.narrow).toBe(false);
    expect(b.find((x) => x.event === s)!.narrow).toBe(false);
  });
  it('treats tiny entries drawn at the same spot as overlapping', () => {
    const a = ev('sleep', L(16, 3), L(16, 3)), b = ev('nursing', L(16, 3), L(16, 3));
    expect(columnBlocks([a, b], col, L(16, 18)).filter((x) => x.narrow)).toHaveLength(0);
    expect(columnBlocks([a, b], col, L(16, 18), 3 / 600).filter((x) => x.narrow)).toHaveLength(1);
  });
  it('includes bottles and diapers as instants, excludes other types and other days', () => {
    const items = [ev('bottle', L(16, 2), null), ev('diaper', L(16, 3), null), ev('bath', L(16, 4), null), ev('bottle', L(14, 2), null)];
    const b = columnBlocks(items, col, L(16, 18));
    expect(b.map((x) => x.kind).sort()).toEqual(['bottle', 'diaper']);
    expect(b[0].top).toBe(b[0].bottom);
  });
});

describe('helpers', () => {
  it('snaps to 5 minutes and labels hours from the cutoff', () => {
    expect(snap(L(16, 2, 7)).getTime()).toBe(L(16, 2, 5).getTime());
    expect(snap(L(16, 2, 8)).getTime()).toBe(L(16, 2, 10).getTime());
    expect(hourTicks(19).map((t) => t.label)).toEqual(['7p', '10p', '1a', '4a', '7a', '10a', '1p', '4p', '7p']);
  });
});
