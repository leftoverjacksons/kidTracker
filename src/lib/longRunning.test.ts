import { describe, expect, it } from 'vitest';
import { overdue, snooze, STILL_RUNNING_MIN } from './longRunning';
import type { EventRow } from './types';

const now = new Date('2026-10-18T12:00:00Z');
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
const ev = (id: string, type: EventRow['type'], startedMinAgo: number) =>
  ({ id, type, started_at: ago(startedMinAgo), ended_at: null }) as EventRow;

describe('still running check', () => {
  it('uses the agreed thresholds', () => {
    expect(STILL_RUNNING_MIN).toEqual({ sleep: 240, nursing: 60, pump: 30, tummy_time: 30, bottle: 45 });
  });
  it('flags timers at or past their threshold, oldest first', () => {
    const r = { sleep: ev('s', 'sleep', 239), nursing: ev('n', 'nursing', 60), pump: ev('p', 'pump', 90) };
    expect(overdue(r, now, {}).map((e) => e.id)).toEqual(['p', 'n']);
  });
  it('a snooze hides it for one more threshold interval', () => {
    const p = ev('p', 'pump', 31);
    const s = snooze({}, p, now, ['p']);
    expect(overdue({ pump: p }, new Date(now.getTime() + 29 * 60_000), s)).toEqual([]);
    expect(overdue({ pump: p }, new Date(now.getTime() + 30 * 60_000), s).map((e) => e.id)).toEqual(['p']);
  });
  it('drops snoozes for timers that stopped', () => {
    const s = snooze({ old: 1e15 }, ev('p', 'pump', 31), now, ['p']);
    expect(Object.keys(s)).toEqual(['p']);
  });
});
