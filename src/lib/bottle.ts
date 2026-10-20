import { isoDay } from './reports';
import type { EventRow } from './types';

/** Shortest timed bottle that counts for flow rate (shorter ones are treated as untimed). */
export const MIN_TIMED_MIN = 1;

/** Minutes a finished bottle took, or null if it wasn't timed. */
export function bottleMinutes(e: Pick<EventRow, 'type' | 'started_at' | 'ended_at'>): number | null {
  if (e.type !== 'bottle' || !e.ended_at) return null;
  const min = (Date.parse(e.ended_at) - Date.parse(e.started_at)) / 60_000;
  return min >= MIN_TIMED_MIN ? min : null;
}

/** Millilitres per minute for a finished, timed bottle with an amount; else null. */
export function flowRate(e: Pick<EventRow, 'type' | 'started_at' | 'ended_at' | 'bottle_ml'>): number | null {
  const min = bottleMinutes(e);
  return min && e.bottle_ml ? Number(e.bottle_ml) / min : null;
}

/**
 * Average flow per day (total ml ÷ total minutes of that day's timed bottles), for `days`
 * (YYYY-MM-DD, local). null on days without a timed bottle.
 */
export function flowByDay(events: EventRow[], days: string[]): (number | null)[] {
  const ml = new Map<string, number>(), min = new Map<string, number>();
  for (const e of events) {
    const m = bottleMinutes(e);
    if (!m || !e.bottle_ml || e.deleted_at) continue;
    const d = isoDay(new Date(e.started_at));
    ml.set(d, (ml.get(d) ?? 0) + Number(e.bottle_ml));
    min.set(d, (min.get(d) ?? 0) + m);
  }
  return days.map((d) => (min.get(d) ? ml.get(d)! / min.get(d)! : null));
}
