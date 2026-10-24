import { describe, expect, it } from 'vitest';
import { cumulativeIntake, cumulativePumped, hourMarks, last24 } from './daily';
import { readPlan } from './feeding';
import type { EventRow } from './types';

const now = new Date('2026-10-24T20:00:00Z');
const ago = (h: number, m = 0) => new Date(now.getTime() - h * 3_600_000 + m * 60_000).toISOString();
const base = { ended_at: null, bottle_ml: null, bottle_contents: null, diaper_wet: null, diaper_dirty: null, pump_left_ml: null, pump_right_ml: null, deleted_at: null };
const plan = readPlan({ target: 'age', nursing_ml_per_min: 2, every_min: 180 });
const events = [
  { ...base, type: 'sleep', started_at: ago(26), ended_at: ago(22) },                       // 2 h inside the window
  { ...base, type: 'sleep', started_at: ago(1) },                                            // running: 1 h
  { ...base, type: 'bottle', started_at: ago(5), ended_at: ago(5), bottle_ml: 80, bottle_contents: 'breast_milk' },
  { ...base, type: 'bottle', started_at: ago(2), ended_at: ago(2), bottle_ml: 60, bottle_contents: 'formula' },
  { ...base, type: 'bottle', started_at: ago(30), ended_at: ago(30), bottle_ml: 90, bottle_contents: 'formula' }, // outside
  { ...base, type: 'nursing', started_at: ago(5, -20), ended_at: ago(5, -5) },               // 15 min → 30 ml
  { ...base, type: 'diaper', started_at: ago(3), diaper_wet: true, diaper_dirty: true },
  { ...base, type: 'diaper', started_at: ago(4), diaper_wet: true },
  { ...base, type: 'pump', started_at: ago(6), ended_at: ago(6, 20), pump_left_ml: 50, pump_right_ml: 40 },
  { ...base, type: 'bottle', started_at: ago(1), ended_at: ago(1), bottle_ml: 999, deleted_at: ago(0) },        // deleted
] as unknown as EventRow[];

describe('last 24 hours', () => {
  it('totals only what falls in the window; running sleep counts to now', () => {
    const t = last24(events, plan, now);
    expect(t.sleepMin).toBe(180);
    expect(t).toMatchObject({ bottleMl: 140, wet: 2, dirty: 1, pumpMl: 90, nursingMin: 15, intakeMl: 170 });
    expect(t.feeds).toBe(2); // nursing + 80 ml bottle are one feed; the 60 ml bottle another
  });
  it('cumulative intake and pumping by hour', () => {
    const marks = hourMarks(now);
    expect(marks).toHaveLength(25);
    const c = cumulativeIntake(events, plan, marks);
    expect(c.bm.at(-1)).toBe(80);
    expect(c.formula.at(-1)).toBe(60);
    expect(c.nursing.at(-1)).toBe(30);
    expect(c.bm[18]).toBe(0);   // 6 h ago: before the 80 ml bottle
    expect(c.bm[19]).toBe(80);  // 5 h ago
    const p = cumulativePumped(events, marks);
    expect([p.left.at(-1), p.right.at(-1), p.left[17]]).toEqual([50, 40, 0]);
  });
});
