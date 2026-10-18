import { describe, expect, it } from 'vitest';
import { conflictsFor, isNow, type Action } from './conflicts';
import type { EventRow } from './types';

const run = (type: string, extra: Partial<EventRow> = {}) =>
  ({ id: type, type, started_at: '2026-10-18T10:00:00Z', ended_at: null, nursing_segments: [], pump_side: null, ...extra }) as unknown as EventRow;
const nursingOn = (side: 'left' | 'right' | null) => run('nursing', {
  nursing_segments: side ? [{ id: 's', event_id: 'nursing', side, started_at: '2026-10-18T10:00:00Z', ended_at: null }] : [],
});
const ids = (a: Action, r: EventRow[]) => conflictsFor(a, r).map((e) => e.id).sort();

describe('auto-stop rules', () => {
  const sleep = run('sleep'), tummy = run('tummy_time');
  it('awake actions end sleep', () => {
    for (const k of ['bottle', 'diaper', 'bath', 'start_tummy'] as const) expect(ids({ kind: k }, [sleep])).toEqual(['sleep']);
    expect(ids({ kind: 'start_nursing', side: 'left' }, [sleep])).toEqual(['sleep']);
  });
  it('sleep ends nursing and tummy time; bottle ends nursing', () => {
    expect(ids({ kind: 'start_sleep' }, [nursingOn('left'), tummy])).toEqual(['nursing', 'tummy_time']);
    expect(ids({ kind: 'bottle' }, [nursingOn('right')])).toEqual(['nursing']);
  });
  it('nursing a side ends pumping on that side or both, not the other side', () => {
    expect(ids({ kind: 'start_nursing', side: 'right' }, [run('pump', { pump_side: 'right' })])).toEqual(['pump']);
    expect(ids({ kind: 'switch_nursing', side: 'left' }, [run('pump', { pump_side: 'both' })])).toEqual(['pump']);
    expect(ids({ kind: 'start_nursing', side: 'left' }, [run('pump', { pump_side: 'right' })])).toEqual([]);
  });
  it('pumping a side ends nursing only if that side is in use', () => {
    expect(ids({ kind: 'start_pump', side: 'right' }, [nursingOn('right')])).toEqual(['nursing']);
    expect(ids({ kind: 'start_pump', side: 'both' }, [nursingOn('left')])).toEqual(['nursing']);
    expect(ids({ kind: 'start_pump', side: 'left' }, [nursingOn('right')])).toEqual([]);
    expect(ids({ kind: 'start_pump', side: 'both' }, [nursingOn(null)])).toEqual([]); // paused
  });
  it('unrelated actions do not interrupt', () => {
    expect(ids({ kind: 'bottle' }, [run('pump', { pump_side: 'both' })])).toEqual([]);
    expect(ids({ kind: 'diaper' }, [nursingOn('left'), run('pump', { pump_side: 'left' }), tummy])).toEqual([]);
    expect(ids({ kind: 'start_pump', side: 'left' }, [sleep])).toEqual([]);
  });
  it('only "now" entries count', () => {
    const now = new Date('2026-10-18T12:00:00Z');
    expect(isNow(new Date('2026-10-18T11:57:00Z'), now)).toBe(true);
    expect(isNow(new Date('2026-10-18T11:40:00Z'), now)).toBe(false);
  });
});
