import { isoDay } from './reports';
import type { EventRow } from './types';

/** Bottles the household compares (design doc §8a L). */
export const BOTTLE_BRANDS = ['Comotomo', 'Philips Avent', 'MAM', "Dr. Brown's", 'Spectra', 'Lansinoh SS', 'Lansinoh S', 'Other'] as const;

/** Shortest timed bottle that counts for flow rate (shorter ones are treated as untimed). */
export const MIN_TIMED_MIN = 1;

/**
 * Milliseconds a timer has been actively running: wall time minus pauses (migration 0010).
 * `now` is used while it's running; a paused timer stays frozen at the moment it paused.
 */
export function activeMs(e: Pick<EventRow, 'started_at' | 'ended_at' | 'paused_at' | 'paused_s'>, now: Date = new Date()): number {
  const end = e.ended_at ? Date.parse(e.ended_at) : e.paused_at ? Date.parse(e.paused_at) : now.getTime();
  return Math.max(0, end - Date.parse(e.started_at) - (e.paused_s ?? 0) * 1000);
}

/** Minutes a finished bottle took (not counting pauses), or null if it wasn't timed. */
export function bottleMinutes(e: Pick<EventRow, 'type' | 'started_at' | 'ended_at' | 'paused_at' | 'paused_s'>): number | null {
  if (e.type !== 'bottle' || !e.ended_at) return null;
  const min = activeMs(e) / 60_000;
  return min >= MIN_TIMED_MIN ? min : null;
}

/** Millilitres per minute for a finished, timed bottle with an amount; else null. */
export function flowRate(e: Pick<EventRow, 'type' | 'started_at' | 'ended_at' | 'bottle_ml' | 'paused_at' | 'paused_s'>): number | null {
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

export interface TimedBottle { e: EventRow; brand: string; minutes: number; ml: number; rate: number }

/** Finished, timed bottles with an amount, newest first. */
export function timedBottles(events: EventRow[], since: Date): TimedBottle[] {
  const out: TimedBottle[] = [];
  for (const e of events) {
    if (e.type !== 'bottle' || e.deleted_at || Date.parse(e.started_at) < since.getTime()) continue;
    const minutes = bottleMinutes(e), rate = flowRate(e);
    if (!minutes || !rate) continue;
    out.push({ e, brand: e.bottle_brand || 'Not set', minutes, ml: Number(e.bottle_ml), rate });
  }
  return out.sort((a, b) => b.e.started_at.localeCompare(a.e.started_at));
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Per brand: feeds, median flow (ml/min), median minutes, median ml. Brands in list order, "Not set" last. */
export function byBrand(feeds: TimedBottle[]) {
  const order = [...BOTTLE_BRANDS, 'Not set'] as string[];
  const names = [...new Set(feeds.map((f) => f.brand))].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  return names.map((brand) => {
    const f = feeds.filter((x) => x.brand === brand);
    return { brand, feeds: f.length, rate: median(f.map((x) => x.rate))!, minutes: median(f.map((x) => x.minutes))!, ml: median(f.map((x) => x.ml))! };
  });
}
