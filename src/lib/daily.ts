import { nursingMinutes, type FeedingPlan } from './feeding';
import { countFeeds } from './nursing';
import type { EventRow } from './types';

/** Reports → Daily (design doc §8a R): the rolling last 24 hours. */
const H = 3_600_000;

type Ev = Pick<EventRow, 'type' | 'started_at' | 'ended_at' | 'bottle_ml' | 'bottle_contents' | 'diaper_wet' | 'diaper_dirty' | 'pump_left_ml' | 'pump_right_ml' | 'deleted_at'> & { nursing_segments?: EventRow['nursing_segments'] };

const inWindow = (e: Ev, from: number, now: number) => !e.deleted_at && Date.parse(e.started_at) >= from && Date.parse(e.started_at) <= now;

/** Totals for the 24 hours ending at `now`. Running timers count up to `now`. */
export function last24(events: Ev[], plan: FeedingPlan, now: Date = new Date()) {
  const t = now.getTime(), from = t - 24 * H;
  let sleepMs = 0, bottleMl = 0, wet = 0, dirty = 0, pumpMl = 0, nursingMin = 0;
  for (const e of events) {
    if (e.deleted_at) continue;
    if (e.type === 'sleep') {
      const s = Date.parse(e.started_at), en = e.ended_at ? Date.parse(e.ended_at) : t;
      sleepMs += Math.max(0, Math.min(en, t) - Math.max(s, from)); // only the part inside the window
      continue;
    }
    if (!inWindow(e, from, t)) continue;
    if (e.type === 'bottle' && e.ended_at) bottleMl += Number(e.bottle_ml ?? 0);
    if (e.type === 'diaper') { if (e.diaper_wet) wet++; if (e.diaper_dirty) dirty++; }
    if (e.type === 'pump') pumpMl += Number(e.pump_left_ml ?? 0) + Number(e.pump_right_ml ?? 0);
    if (e.type === 'nursing') nursingMin += nursingMinutes(e.ended_at ? e : { ...e, ended_at: now.toISOString() });
  }
  return {
    sleepMin: sleepMs / 60_000, feeds: countFeeds(events.filter((e) => !e.deleted_at), new Date(from)),
    bottleMl, wet, dirty, pumpMl, nursingMin, intakeMl: bottleMl + nursingMin * plan.nursing_ml_per_min,
  };
}

/** Hour marks from 24 h ago to now (25 points; the last is `now`), for the cumulative charts. */
export function hourMarks(now: Date = new Date()): Date[] {
  return Array.from({ length: 25 }, (_, k) => new Date(now.getTime() - (24 - k) * H));
}

/**
 * Cumulative intake at each mark, by kind: bottles count at their start, nursing at its
 * start (its minutes × the credit). Mixed or unlabelled bottles are their own kind.
 */
export function cumulativeIntake(events: Ev[], plan: FeedingPlan, marks: Date[]) {
  const from = marks[0].getTime(), to = marks[marks.length - 1].getTime();
  const items = events.filter((e) => inWindow(e, from, to)).flatMap((e) => {
    const at = Date.parse(e.started_at);
    if (e.type === 'bottle' && e.ended_at) {
      const kind = e.bottle_contents === 'breast_milk' ? 'bm' : e.bottle_contents === 'formula' ? 'f' : 'other';
      return [{ at, kind, ml: Number(e.bottle_ml ?? 0) }];
    }
    if (e.type === 'nursing') {
      const min = nursingMinutes(e.ended_at ? e : { ...e, ended_at: new Date(to).toISOString() });
      return [{ at, kind: 'n', ml: min * plan.nursing_ml_per_min }];
    }
    return [];
  });
  const at = (kind: string) => marks.map((m) => items.filter((i) => i.kind === kind && i.at <= m.getTime()).reduce((a, i) => a + i.ml, 0));
  return { bm: at('bm'), formula: at('f'), other: at('other'), nursing: at('n') };
}

/** Cumulative millilitres pumped per breast at each mark (sessions count at their start). */
export function cumulativePumped(events: Ev[], marks: Date[]) {
  const from = marks[0].getTime(), to = marks[marks.length - 1].getTime();
  const pumps = events.filter((e) => e.type === 'pump' && inWindow(e, from, to));
  const at = (k: 'pump_left_ml' | 'pump_right_ml') =>
    marks.map((m) => pumps.filter((p) => Date.parse(p.started_at) <= m.getTime()).reduce((a, p) => a + Number(p[k] ?? 0), 0));
  return { left: at('pump_left_ml'), right: at('pump_right_ml') };
}
