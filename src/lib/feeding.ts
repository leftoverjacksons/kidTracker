import { FEED_GAP_MIN, sideTotals } from './nursing';
import type { NursingSegment } from './types';

/**
 * Feeding targets and "next feed" (design doc §8a Q).
 *
 * A feed groups nursing and bottle entries that start within FEED_GAP_MIN of the previous
 * one ending. Its estimated intake is the bottle millilitres plus nursing minutes times a
 * per-minute credit: 2.1 ml/min by default, from the weighed feed at the consult (1 oz in 14 min).
 */

export interface FeedingPlan {
  /** 'age' = the lactation handout's curve; otherwise the family's own range. */
  target: 'age' | { min_ml: number; max_ml: number };
  nursing_ml_per_min: number;
  every_min: number;
}

export const DEFAULT_PLAN: FeedingPlan = { target: 'age', nursing_ml_per_min: 2.1, every_min: 180 };

/** Accepts whatever is stored (or nothing) and returns a usable plan. */
export function readPlan(raw: unknown): FeedingPlan {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<FeedingPlan>;
  const t = r.target;
  const target = t && typeof t === 'object' && t.min_ml > 0 && t.max_ml >= t.min_ml ? { min_ml: t.min_ml, max_ml: t.max_ml } : 'age';
  const rate = Number(r.nursing_ml_per_min);
  const every = Number(r.every_min);
  return {
    target,
    nursing_ml_per_min: rate >= 0 && rate <= 20 ? rate : DEFAULT_PLAN.nursing_ml_per_min,
    every_min: every >= 60 && every <= 360 ? every : DEFAULT_PLAN.every_min,
  };
}

/**
 * The handout's expected intake per feed (days 4–7: 1.5–2 oz; week 2: 2.5–3 oz;
 * week 3: 3.5–4 oz; weeks 4–6+: 4–5 oz), each taken as true at the middle of its
 * week, joined by straight lines so the target rises a little each day instead of
 * jumping at week boundaries. Flat before day 5.5 (the handout starts at day 4) and
 * after day 25.
 */
export const AGE_CURVE: { day: number; min: number; max: number }[] = [
  { day: 5.5, min: 45, max: 60 },
  { day: 11, min: 75, max: 90 },
  { day: 18, min: 105, max: 120 },
  { day: 25, min: 120, max: 150 },
];

export function ageTarget(dayOfLife: number): { min: number; max: number } {
  const c = AGE_CURVE;
  if (dayOfLife <= c[0].day) return { min: c[0].min, max: c[0].max };
  for (let i = 1; i < c.length; i++) {
    if (dayOfLife <= c[i].day) {
      const f = (dayOfLife - c[i - 1].day) / (c[i].day - c[i - 1].day);
      const lerp = (a: number, b: number) => Math.round(a + (b - a) * f);
      return { min: lerp(c[i - 1].min, c[i].min), max: lerp(c[i - 1].max, c[i].max) };
    }
  }
  const last = c[c.length - 1];
  return { min: last.min, max: last.max };
}

/** Days since the birth date (birth date = day 0), fractional, at time `t`. */
export function dayOfLife(birthDate: string, t: Date): number {
  const [y, m, d] = birthDate.split('-').map(Number);
  return (t.getTime() - new Date(y, m - 1, d).getTime()) / 86_400_000;
}

/** Target per feed (ml) at time `t`: the family's own range, else the age curve (needs a birth date). */
export function targetAt(plan: FeedingPlan, birthDate: string | null, t: Date): { min: number; max: number } | null {
  if (plan.target !== 'age') return { min: plan.target.min_ml, max: plan.target.max_ml };
  return birthDate ? ageTarget(dayOfLife(birthDate, t)) : null;
}

export interface Feed {
  start: Date;
  end: Date;
  bottleMl: number;
  nursingMin: number;
  /** bottleMl + nursingMin × the plan's credit */
  estMl: number;
}

export type FeedEvent = { type: string; started_at: string; ended_at: string | null; bottle_ml: number | null; nursing_segments?: NursingSegment[] | null };

function nursingMinutes(e: FeedEvent): number {
  const t = sideTotals(e.nursing_segments ?? []);
  const ms = t.left + t.right || (e.ended_at ? Date.parse(e.ended_at) - Date.parse(e.started_at) : 0);
  return Math.max(0, ms / 60_000);
}

/** Finished nursing entries and bottles grouped into feeds, oldest first. */
export function feeds(events: FeedEvent[], plan: FeedingPlan): Feed[] {
  const items = events
    .filter((e) => (e.type === 'nursing' || e.type === 'bottle') && e.ended_at)
    .map((e) => ({ s: Date.parse(e.started_at), e: Date.parse(e.ended_at!), ml: e.type === 'bottle' ? Number(e.bottle_ml ?? 0) : 0, min: e.type === 'nursing' ? nursingMinutes(e) : 0 }))
    .sort((a, b) => a.s - b.s);
  const out: Feed[] = [];
  for (const it of items) {
    const cur = out[out.length - 1];
    if (cur && it.s - cur.end.getTime() <= FEED_GAP_MIN * 60_000) {
      cur.end = new Date(Math.max(cur.end.getTime(), it.e));
      cur.bottleMl += it.ml; cur.nursingMin += it.min;
    } else {
      out.push({ start: new Date(it.s), end: new Date(it.e), bottleMl: it.ml, nursingMin: it.min, estMl: 0 });
    }
  }
  for (const f of out) f.estMl = f.bottleMl + f.nursingMin * plan.nursing_ml_per_min;
  return out;
}

/**
 * When the next feed is due. The middle of the target buys exactly the interval
 * ("feed every 3 h"); less brings the next feed closer in proportion, more pushes it
 * later in proportion, but never past what a top-of-target feed buys (with 75–90 ml:
 * 82.5 ml → 3 h, 60 ml → 2 h 11 m, 90 ml or more → 3 h 16 m). Feeds close together
 * add up: a top-up extends whatever time the previous feeds left, within the same cap
 * measured from the top-up's start.
 */
export function nextFeed(all: Feed[], plan: FeedingPlan, birthDate: string | null, now: Date = new Date()) {
  const recent = all.filter((f) => f.start.getTime() > now.getTime() - 2 * 86_400_000 && f.start <= now);
  if (!recent.length) return null;
  const interval = plan.every_min * 60_000;
  let due: number | null = null;
  for (const f of recent) {
    const target = targetAt(plan, birthDate, f.start);
    const mid = target ? (target.min + target.max) / 2 : 0;
    const share = mid > 0 ? f.estMl / mid : 1;
    const maxShare = mid > 0 ? target!.max / mid : 1;
    const from: number = due == null ? f.start.getTime() : Math.max(due, f.start.getTime());
    due = Math.min(from + interval * share, f.start.getTime() + interval * maxShare);
  }
  const last = recent[recent.length - 1];
  return { due: new Date(due!), last, target: targetAt(plan, birthDate, now) };
}

/** Average estimated intake per feed for each local day in `days` (YYYY-MM-DD); null where there was no feed. */
export function averageFeedByDay(all: Feed[], days: string[], dayOf: (d: Date) => string): (number | null)[] {
  const sum = new Map<string, { ml: number; n: number }>();
  for (const f of all) {
    const k = dayOf(f.start);
    const v = sum.get(k) ?? { ml: 0, n: 0 };
    v.ml += f.estMl; v.n += 1;
    sum.set(k, v);
  }
  return days.map((d) => { const v = sum.get(d); return v ? Math.round(v.ml / v.n) : null; });
}

/**
 * Pump sessions that line up with a feed: started from 30 minutes before a feed began
 * to 30 minutes after it ended (the care plan pairs pumping with bottle feeds).
 */
export function pumpsWithFeeds(events: { type: string; started_at: string; ended_at: string | null }[], all: Feed[], from: Date): { aligned: number; total: number } {
  const W = 30 * 60_000;
  const pumps = events.filter((e) => e.type === 'pump' && e.ended_at && Date.parse(e.started_at) >= from.getTime());
  const aligned = pumps.filter((p) => {
    const t = Date.parse(p.started_at);
    return all.some((f) => t >= f.start.getTime() - W && t <= f.end.getTime() + W);
  }).length;
  return { aligned, total: pumps.length };
}

/** A pump session and a feed this close together are lined up… */
export const ALIGN_WINDOW_MIN = 30;
/** …but pumping never moves to less than this long after the last pumping session. */
export const PUMP_MIN_GAP_MIN = 120;

export interface Schedule<P extends { due: Date; last: Date }> {
  /** Next feed (null without a feed in the last two days); `due` already adjusted. */
  feed: (NonNullable<ReturnType<typeof nextFeed>> & { withPump: boolean }) | null;
  /** Next pumping session (null when reminders are off etc.); `due` already adjusted. */
  pump: (P & { withFeed: boolean }) | null;
}

/**
 * Line pumping and feeds up (design doc §8a Q). `pump` is the plain next pumping session
 * (pumpDue); `current` are start times of feeds happening now or that started within the
 * last 30 minutes.
 * - Pump due within 30 min of a feed that's happening now: the pump joins that feed.
 * - Otherwise, pump due within 30 min of the next forecast feed: both move to meet halfway.
 * In both cases pumping never moves to less than 2 h after the last session; if that floor
 * pushes the meeting point later, the feed moves with it (so they still coincide).
 */
export function schedule<P extends { due: Date; last: Date }>(next: ReturnType<typeof nextFeed>, pump: P | null, current: Date[], now: Date = new Date()): Schedule<P> {
  const W = ALIGN_WINDOW_MIN * 60_000;
  const feed = next ? { ...next, withPump: false } : null;
  if (!pump) return { feed, pump: null };
  const floor = pump.last.getTime() + PUMP_MIN_GAP_MIN * 60_000;
  const p = pump.due.getTime();
  const happening = current.map((t) => t.getTime()).filter((t) => t >= now.getTime() - W && t <= now.getTime() && Math.abs(t - p) <= W)
    .sort((x, y) => Math.abs(x - p) - Math.abs(y - p))[0];
  if (happening != null) return { feed, pump: { ...pump, due: new Date(Math.max(happening, floor)), withFeed: true } };
  if (feed && Math.abs(feed.due.getTime() - p) <= W) {
    const meet = new Date(Math.max((feed.due.getTime() + p) / 2, floor));
    return { feed: { ...feed, due: meet, withPump: true }, pump: { ...pump, due: meet, withFeed: true } };
  }
  return { feed, pump: { ...pump, withFeed: false } };
}

/**
 * The feed that can still be topped up: one that's happening now (nursing in progress)
 * or ended less than FEED_GAP_MIN ago, so a bottle now would count as part of it.
 * Nursing in progress is counted up to `now`.
 */
export function openFeed(events: FeedEvent[], plan: FeedingPlan, now: Date = new Date()): Feed | null {
  const asOfNow = events.map((e) => (e.type === 'nursing' && !e.ended_at && Date.parse(e.started_at) <= now.getTime()
    ? { ...e, ended_at: now.toISOString(), nursing_segments: (e.nursing_segments ?? []).map((s) => (s.ended_at ? s : { ...s, ended_at: now.toISOString() })) }
    : e));
  const last = feeds(asOfNow, plan).filter((f) => f.start <= now).pop();
  return last && now.getTime() - last.end.getTime() < FEED_GAP_MIN * 60_000 ? last : null;
}

/** Top-up that would make `soFar` (ml, estimated) a full feed: up to the target range; 0 once reached. */
export function topUp(soFarMl: number, target: { min: number; max: number }): { min: number; max: number } {
  return { min: Math.max(0, Math.round(target.min - soFarMl)), max: Math.max(0, Math.round(target.max - soFarMl)) };
}

/**
 * The handout's expected intake per day (days 4–7: 12–16 oz; week 2: 20–24 oz; week 3:
 * 26–28 oz; weeks 4–6+: 28–32 oz), placed and joined like AGE_CURVE.
 */
export const DAILY_CURVE: { day: number; min: number; max: number }[] = [
  { day: 5.5, min: 355, max: 475 },
  { day: 11, min: 590, max: 710 },
  { day: 18, min: 770, max: 830 },
  { day: 25, min: 830, max: 945 },
];

/** Daily intake target: the handout's daily curve by age, or 8 feeds × the family's own range. */
export function dailyTargetAt(plan: FeedingPlan, birthDate: string | null, t: Date): { min: number; max: number } | null {
  if (plan.target !== 'age') return { min: plan.target.min_ml * 8, max: plan.target.max_ml * 8 };
  if (!birthDate) return null;
  const d = dayOfLife(birthDate, t), c = DAILY_CURVE;
  if (d <= c[0].day) return { min: c[0].min, max: c[0].max };
  for (let i = 1; i < c.length; i++) {
    if (d <= c[i].day) {
      const f = (d - c[i - 1].day) / (c[i].day - c[i - 1].day);
      return { min: Math.round(c[i - 1].min + (c[i].min - c[i - 1].min) * f), max: Math.round(c[i - 1].max + (c[i].max - c[i - 1].max) * f) };
    }
  }
  return { min: c[c.length - 1].min, max: c[c.length - 1].max };
}
