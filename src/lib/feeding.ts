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
  /** Minutes between feeds, or 'age' = the handout's daily intake ÷ its per-feed amount (feedEveryMin). */
  every_min: number | 'age';
  /** Anchored schedule (design doc §8a X): a fixed bedtime feed, then a night stretch; null = flexible. */
  anchor: Anchor | null;
  /** Fewest feeds a day the anchored schedule plans (8 until his consultant says fewer). */
  min_feeds: number;
}

export interface Anchor {
  /** Bedtime feed, minutes after local midnight (1380 = 11 PM). */
  bedtime_min: number;
  /** Planned gap after the bedtime feed, minutes. */
  night_min: number;
  /** A second night gap after the next feed (from day 21; null = one night gap). */
  night2_min: number | null;
  /** With two night gaps: daytime gaps are kept within this range (minutes, default 2½–3 h). */
  day_gap_min: number;
  day_gap_max: number;
  /** Time zone the bedtime is in (the phone's, when it was set), so every phone and the server agree. */
  tz: string;
}

export const DEFAULT_PLAN: FeedingPlan = { target: 'age', nursing_ml_per_min: 2.1, every_min: 'age', anchor: null, min_feeds: 8 };

/** Accepts whatever is stored (or nothing) and returns a usable plan. */
export function readPlan(raw: unknown): FeedingPlan {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<FeedingPlan>;
  const t = r.target;
  const target = t && typeof t === 'object' && t.min_ml > 0 && t.max_ml >= t.min_ml ? { min_ml: t.min_ml, max_ml: t.max_ml } : 'age';
  const rate = Number(r.nursing_ml_per_min);
  const every = Number(r.every_min);
  const a = r.anchor, feeds = Number(r.min_feeds);
  return {
    target,
    nursing_ml_per_min: rate >= 0 && rate <= 20 ? rate : DEFAULT_PLAN.nursing_ml_per_min,
    every_min: r.every_min !== 'age' && every >= 60 && every <= 360 ? every : 'age',
    anchor: a && typeof a === 'object' && a.bedtime_min >= 0 && a.bedtime_min < 1440 && a.night_min >= 120 && a.night_min <= 360 && typeof a.tz === 'string' && a.tz
      ? readAnchor(a) : null,
    min_feeds: feeds >= 6 && feeds <= 12 ? Math.round(feeds) : DEFAULT_PLAN.min_feeds,
  };
}

function readAnchor(a: Anchor): Anchor {
  const n2 = Number(a.night2_min), lo = Number(a.day_gap_min), hi = Number(a.day_gap_max);
  const gaps = lo >= 60 && hi >= lo && hi <= 300;
  return {
    bedtime_min: a.bedtime_min, night_min: a.night_min, tz: a.tz,
    night2_min: a.night2_min != null && n2 >= 120 && n2 <= 360 ? n2 : null,
    day_gap_min: gaps ? lo : 150, day_gap_max: gaps ? hi : 180,
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
  /** The entries that make up this feed (when the events have ids), oldest first. */
  ids: string[];
}

export type FeedEvent = { id?: string; type: string; started_at: string; ended_at: string | null; bottle_ml: number | null; nursing_segments?: NursingSegment[] | null };

export function nursingMinutes(e: FeedEvent): number {
  const t = sideTotals(e.nursing_segments ?? []);
  const ms = t.left + t.right || (e.ended_at ? Date.parse(e.ended_at) - Date.parse(e.started_at) : 0);
  return Math.max(0, ms / 60_000);
}

/** Finished nursing entries and bottles grouped into feeds, oldest first. */
export function feeds(events: FeedEvent[], plan: FeedingPlan): Feed[] {
  const items = events
    .filter((e) => (e.type === 'nursing' || e.type === 'bottle') && e.ended_at)
    .map((e) => ({ id: e.id, s: Date.parse(e.started_at), e: Date.parse(e.ended_at!), ml: e.type === 'bottle' ? Number(e.bottle_ml ?? 0) : 0, min: e.type === 'nursing' ? nursingMinutes(e) : 0 }))
    .sort((a, b) => a.s - b.s);
  const out: Feed[] = [];
  for (const it of items) {
    const cur = out[out.length - 1];
    if (cur && it.s - cur.end.getTime() <= FEED_GAP_MIN * 60_000) {
      cur.end = new Date(Math.max(cur.end.getTime(), it.e));
      cur.bottleMl += it.ml; cur.nursingMin += it.min;
      if (it.id) cur.ids.push(it.id);
    } else {
      out.push({ start: new Date(it.s), end: new Date(it.e), bottleMl: it.ml, nursingMin: it.min, estMl: 0, ids: it.id ? [it.id] : [] });
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
  let due: number | null = null;
  for (const f of recent) {
    if (plan.anchor) {
      // Anchored: the planned gap after a feed at this time. The amount planned for that gap (a full
      // feed for a full gap or the night, less for a shorter one) buys all of it, less its share,
      // more no more (so the day still lands on the bedtime feed).
      const g = anchoredGap(f.start.getTime(), plan.anchor, anchorShape(plan, birthDate, f.start));
      const gap = g.min * 60_000;
      const each = feedSize(plan, birthDate, f.start);
      const planned = each * (g.night ? 1 : Math.min(1, g.min / g.spacing));
      const share = planned > 0 ? Math.min(1, f.estMl / planned) : 1;
      const from: number = due == null ? f.start.getTime() : Math.max(due, f.start.getTime());
      due = Math.min(from + gap * share, f.start.getTime() + gap);
      continue;
    }
    const interval = feedEveryMin(plan, birthDate, f.start) * 60_000;
    const target = targetAt(plan, birthDate, f.start);
    const mid = target ? (target.min + target.max) / 2 : 0;
    const share = mid > 0 ? f.estMl / mid : 1;
    const maxShare = mid > 0 ? target!.max / mid : 1;
    const from: number = due == null ? f.start.getTime() : Math.max(due, f.start.getTime());
    due = Math.min(from + interval * share, f.start.getTime() + interval * maxShare);
  }
  const last = recent[recent.length - 1];
  return { due: new Date(due!), last, target: feedTarget(plan, birthDate, now) };
}

/**
 * Typical (median) estimated intake per feed for each local day in `days` (YYYY-MM-DD);
 * null where there was no feed. The median ignores an odd snack or two without labelling
 * anything, but drops when small feeds become the majority (design doc §8a Q).
 */
export function medianFeedByDay(all: Feed[], days: string[], dayOf: (d: Date) => string): (number | null)[] {
  const byDay = new Map<string, number[]>();
  for (const f of all) byDay.set(dayOf(f.start), [...(byDay.get(dayOf(f.start)) ?? []), f.estMl]);
  return days.map((d) => {
    const v = byDay.get(d)?.sort((a, b) => a - b);
    if (!v?.length) return null;
    const m = v.length >> 1;
    return Math.round(v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2);
  });
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
  return birthDate ? dailyAgeTarget(dayOfLife(birthDate, t)) : null;
}

/** The handout's daily intake at an age (days of life), from DAILY_CURVE. */
export function dailyAgeTarget(d: number): { min: number; max: number } {
  const c = DAILY_CURVE;
  if (d <= c[0].day) return { min: c[0].min, max: c[0].max };
  for (let i = 1; i < c.length; i++) {
    if (d <= c[i].day) {
      const f = (d - c[i - 1].day) / (c[i].day - c[i - 1].day);
      return { min: Math.round(c[i - 1].min + (c[i].min - c[i - 1].min) * f), max: Math.round(c[i - 1].max + (c[i].max - c[i - 1].max) * f) };
    }
  }
  return { min: c[c.length - 1].min, max: c[c.length - 1].max };
}

/** Shortest and longest gap the by-age spacing will give (minutes). */
export const EVERY_MIN_RANGE = { min: 120, max: 240 };

/**
 * Minutes between feeds at time `t`. A number in the plan is used as is. 'age' spreads the
 * handout's daily intake over feeds of its per-feed size: 24 h × middle per-feed target ÷
 * middle daily target (day 11: 82.5 of 650 ml → 3 h 3 m; day 18: 112.5 of 800 → 3 h 23 m;
 * day 25 on: 135 of 887.5 → 3 h 39 m), kept within 2–4 h. With the family's own per-feed
 * numbers it is their middle ÷ the handout's daily middle. 3 h without a birth date.
 */
export function feedEveryMin(plan: FeedingPlan, birthDate: string | null, t: Date): number {
  if (plan.every_min !== 'age') return plan.every_min;
  const per = targetAt(plan, birthDate, t);
  if (!per || !birthDate) return 180;
  const daily = dailyAgeTarget(dayOfLife(birthDate, t));
  const min = Math.round((24 * 60 * (per.min + per.max)) / (daily.min + daily.max));
  return Math.min(EVERY_MIN_RANGE.max, Math.max(EVERY_MIN_RANGE.min, min));
}

/**
 * What to aim for at the next feed (design doc §8a Q, catch-up). Normally the target per feed.
 * If the last 24 hours' estimated intake is below the bottom of the daily target, a third of
 * the shortfall is added to the bottom of the range (spread over about three feeds), never
 * above the top of the range. Timing is unchanged: small feeds already bring the next one sooner.
 */
export function aimAt(events: (FeedEvent & { deleted_at?: string | null })[], plan: FeedingPlan, birthDate: string | null, now: Date = new Date(), opts: { next?: boolean } = {}) {
  if (plan.anchor) return anchoredAim(events, plan, birthDate, now, opts);
  const per = feedTarget(plan, birthDate, now);
  if (!per) return null;
  const top = targetAt(plan, birthDate, now)?.max ?? per.max; // never above her top value
  const daily = dailyTargetAt(plan, birthDate, new Date(now.getTime() - 12 * 3_600_000)); // middle of the window, as on Reports → Daily
  const intake = intakeLast24(events, plan, now);
  const behind = daily ? Math.max(0, daily.min - intake) : 0;
  const min = Math.min(top, Math.round(per.min + behind / 3));
  return { min, max: Math.max(per.max, min), catchUp: min > per.min };
}

/**
 * Estimated intake in the 24 hours ending at `now`: finished bottles and nursing (a running
 * session counts up to now) that started in the window. Reports → Daily shows the same number.
 */
export function intakeLast24(events: (FeedEvent & { deleted_at?: string | null })[], plan: FeedingPlan, now: Date = new Date()): number {
  const t = now.getTime(), from = t - 86_400_000;
  let ml = 0;
  for (const e of events) {
    const s = Date.parse(e.started_at);
    if (e.deleted_at || s < from || s > t) continue;
    if (e.type === 'bottle' && e.ended_at) ml += Number(e.bottle_ml ?? 0);
    if (e.type === 'nursing') ml += nursingMinutes(e.ended_at ? e : { ...e, ended_at: now.toISOString() }) * plan.nursing_ml_per_min;
  }
  return ml;
}

// ───────────── Anchored schedule (design doc §8a X) ─────────────

const DAY_MS = 86_400_000;

/** Minutes `tz` is ahead of UTC at time `t` (falls back to this device's zone). */
export function tzOffsetMin(t: number, tz: string): number {
  try {
    const p: Record<string, number> = {};
    for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(t))) p[x.type] = Number(x.value);
    return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(t / 1000) * 1000) / 60_000);
  } catch {
    return -new Date(t).getTimezoneOffset();
  }
}

/** The bedtime-feed moments either side of `t`: the last at or before it and the next after it. */
export function anchorsAround(t: number, a: Anchor): { prev: number; next: number } {
  const off = tzOffsetMin(t, a.tz) * 60_000;
  const day0 = Math.floor((t + off) / DAY_MS) * DAY_MS; // local midnight of t's day, as local ms
  const at = (k: number) => {
    const local = day0 + k * DAY_MS + a.bedtime_min * 60_000;
    return local - tzOffsetMin(local - off, a.tz) * 60_000; // each day's own offset, so DST days still land on the hour
  };
  for (let k = 0; ; k++) if (at(k) > t) return { prev: at(k - 1), next: at(k) };
}

/** A feed from this long before a bedtime moment to BEDTIME_AFTER_MIN after it is the bedtime feed (and buys the night stretch). */
export const BEDTIME_BEFORE_MIN = 60;
export const BEDTIME_AFTER_MIN = 90;

/**
 * Planned gap (minutes) after a feed starting at `start`. The bedtime feed (from 1 h before the
 * anchor to 1½ h after) buys the night stretch. Any other feed splits the time left until the
 * next bedtime feed into equal gaps, splitting only once a gap would run more than 15% over the
 * day's spacing (so neither one long evening gap nor needlessly short ones): with 8 feeds and a
 * 4 h night, (24 h − 4 h) ÷ 7 = 2 h 51 m, so 3 AM → 5:51 → 8:43 → … → 11 PM. A late or early feed just changes how the
 * remaining time is divided, so the day still ends on the bedtime feed.
 */
export function anchoredGapMin(start: number, a: Anchor, feedsADay: number): number {
  return anchoredGap(start, a, oneNightShape(a, feedsADay)).min;
}

/** A gap may run this much over the planned spacing before it is split in two (e.g. 2 h 51 m → up to 3 h 17 m). */
export const SPLIT_TOLERANCE = 1.15;

/** Two night gaps are used from this day of life (the consultant, 2026-11-07: "after week 3"). */
export const TWO_NIGHTS_FROM_DAY = 21;

/**
 * The shape of an anchored day. One night gap: at least `min_feeds` feeds, the rest of the day in
 * equal gaps. Two night gaps (set, and from day 21): bedtime feed, night gap 1, a night feed,
 * night gap 2, then the day filled with gaps kept within the daytime range (2½–3 h): no feed
 * count to meet. `feeds` is the number of feeds a day; `daySpacing` a planned daytime gap.
 */
export interface AnchorShape { two: boolean; feeds: number; daySpacing: number; lo: number; hi: number }

export function anchorShape(plan: FeedingPlan, birthDate: string | null, t: Date): AnchorShape {
  const a = plan.anchor!;
  if (twoNights(plan, birthDate, t)) {
    const day = 1440 - a.night_min - a.night2_min!;
    const k = pickGaps(day, a.day_gap_min, a.day_gap_max);
    return { two: true, feeds: 2 + k, daySpacing: day / k, lo: a.day_gap_min, hi: a.day_gap_max };
  }
  return oneNightShape(a, baseFeedsPerDay(plan, birthDate, t));
}

function oneNightShape(a: Anchor, feeds: number): AnchorShape {
  return { two: false, feeds, daySpacing: (1440 - a.night_min) / Math.max(1, feeds - 1), lo: 0, hi: 0 };
}

/** Whether the second night gap applies: set in the plan, and from day 21 (or no birth date). */
export function twoNights(plan: FeedingPlan, birthDate: string | null, t: Date): boolean {
  return !!plan.anchor?.night2_min && (!birthDate || dayOfLife(birthDate, t) >= TWO_NIGHTS_FROM_DAY);
}

/**
 * How many equal gaps to split `left` minutes into so each is as close as possible to the
 * range [lo, hi] (on a tie, the shorter gaps: feeding more often is the safer side).
 */
export function pickGaps(left: number, lo: number, hi: number): number {
  let best = 1, bestOff = Infinity;
  for (let k = 1; k <= Math.max(1, Math.ceil(left / lo)) + 1; k++) {
    const g = left / k, off = g < lo ? lo - g : g > hi ? g - hi : 0;
    if (off <= bestOff) { best = k; bestOff = off; } // <=: on a tie the larger k (shorter gaps) wins
    if (g < lo) break;
  }
  return best;
}

/**
 * What a feed at `at` is on the anchored schedule: the bedtime feed, the night feed (two-night
 * plan) or a day feed. The bedtime time is a goal: a feed too close to it for a sensible gap
 * (closer than BEDTIME_CLOSE of the shortest daytime gap; of a day gap on the one-night plan)
 * becomes the bedtime feed, and the night starts from it (owner, 2026-11-07).
 */
export function slotKind(at: number, a: Anchor, shape: AnchorShape): 'bedtime' | 'night' | 'day' {
  const { prev, next } = anchorsAround(at, a);
  if (next - at < closeToBedtime(shape) || at - prev <= BEDTIME_AFTER_MIN * 60_000) return 'bedtime';
  if (shape.two && at - prev <= (a.night_min + BEDTIME_AFTER_MIN) * 60_000) return 'night';
  return 'day';
}

/** Fraction of a daytime gap (two-night plan: of its shortest; one-night: of the planned gap) under which a feed is the bedtime feed. */
export const BEDTIME_CLOSE = { two: 0.8, one: 0.55 };

/** How close to the bedtime moment (ms) a feed has to be to become the bedtime feed: at least 1 h. */
export function closeToBedtime(shape: AnchorShape): number {
  return Math.max(BEDTIME_BEFORE_MIN, shape.two ? shape.lo * BEDTIME_CLOSE.two : shape.daySpacing * BEDTIME_CLOSE.one) * 60_000;
}

/**
 * anchoredGapMin, with the planned daytime gap (for weighing a feed's amount) and whether it's a
 * night gap. Two-night plan: the night feed (any feed after the bedtime feed and before the first
 * night gap's end + 1½ h) buys night gap 2; a day feed splits the time left to the bedtime feed
 * into equal gaps as close as possible to the daytime range.
 */
export function anchoredGap(start: number, a: Anchor, shape: AnchorShape): { min: number; spacing: number; night: boolean } {
  const kind = slotKind(start, a, shape);
  if (kind === 'bedtime') return { min: a.night_min, spacing: shape.daySpacing, night: true };
  if (kind === 'night') return { min: a.night2_min!, spacing: shape.daySpacing, night: true };
  const left = (anchorsAround(start, a).next - start) / 60_000;
  let k = shape.two ? pickGaps(left, shape.lo, shape.hi) : Math.max(1, Math.ceil(left / (shape.daySpacing * SPLIT_TOLERANCE) - 1e-9));
  // Never plan a last day feed so close to bedtime that it would count as the bedtime feed itself.
  while (k > 1 && (left / k) * 60_000 < closeToBedtime(shape)) k--;
  return { min: left / k, spacing: shape.daySpacing, night: false };
}

/**
 * Feeds a day the plan works to. Anchored: as anchorShape plans them (two-night plan: however
 * many the daytime gaps give). Otherwise, and for a one-night plan: the handout's daily amount ÷
 * its per-feed amount (fewer as he grows), but never fewer than the plan's minimum (8 to start).
 */
export function feedsPerDay(plan: FeedingPlan, birthDate: string | null, t: Date): number {
  return plan.anchor ? anchorShape(plan, birthDate, t).feeds : baseFeedsPerDay(plan, birthDate, t);
}

function baseFeedsPerDay(plan: FeedingPlan, birthDate: string | null, t: Date): number {
  const per = targetAt(plan, birthDate, t), daily = dailyTargetAt(plan, birthDate, t);
  const byAge = per && daily ? Math.round((daily.min + daily.max) / (per.min + per.max)) : 0;
  return Math.max(plan.min_feeds, byAge);
}

/**
 * Amount to aim for per feed on the anchored schedule: the daily target ÷ planned feeds, ±5%,
 * never above the top of the handout's per-feed range. With 8 feeds the feeds are a little
 * smaller than the handout's per-feed column, which assumes fewer feeds as he grows.
 */
export function planAim(plan: FeedingPlan, birthDate: string | null, t: Date): { min: number; max: number } | null {
  const daily = dailyTargetAt(plan, birthDate, t);
  if (!daily) return targetAt(plan, birthDate, t);
  const each = (daily.min + daily.max) / 2 / feedsPerDay(plan, birthDate, t);
  const top = targetAt(plan, birthDate, t)?.max ?? Infinity;
  const max = Math.min(top, Math.round(each * 1.05));
  return { min: Math.min(max, Math.round(each * 0.95)), max };
}

/** Target per feed for this plan: the anchored schedule's aim, or the per-feed target. */
export function feedTarget(plan: FeedingPlan, birthDate: string | null, t: Date): { min: number; max: number } | null {
  return plan.anchor ? planAim(plan, birthDate, t) : targetAt(plan, birthDate, t);
}

/** Planned feed times from the bedtime feed at or before `t` up to the next one (for Settings). */
export function planSlots(plan: FeedingPlan, birthDate: string | null, t: Date): Date[] {
  if (!plan.anchor) return [];
  const a = plan.anchor, { prev, next } = anchorsAround(t.getTime(), a);
  const shape = anchorShape(plan, birthDate, t);
  const nights = shape.two ? [prev, prev + a.night_min * 60_000] : [prev];
  const first = prev + (a.night_min + (shape.two ? a.night2_min! : 0)) * 60_000;
  const dayFeeds = shape.feeds - nights.length, step = (next - first) / Math.max(1, dayFeeds);
  return [...nights, ...Array.from({ length: dayFeeds }, (_, k) => first + k * step)].map((x) => new Date(x));
}

/** A full feed on the anchored schedule: the daily target ÷ planned feeds (ml), or the per-feed middle. */
export function feedSize(plan: FeedingPlan, birthDate: string | null, t: Date): number {
  const a = planAim(plan, birthDate, t);
  return a ? (a.min + a.max) / 2 : 0;
}

/** Catch-up never asks for more than this times the feed planned for that gap. */
export const CATCHUP_MAX_RAISE = 1.25;

/**
 * What to aim for at the next feed on the anchored schedule (design doc §8a X): the feed planned
 * for its gap, so intake stays even (a full feed, daily target ÷ planned feeds, for a full gap or
 * the bedtime feed; proportionally less after a shorter gap). Only if the last 24 hours are below
 * the daily band (judged at the window's middle, as on Reports → Daily) is a third of the shortfall
 * added, at most up to 1¼ × the planned feed and never above the handout's top. Never lowered when
 * he's ahead: he sets how much he takes. A feed still open (topping up) is the one aimed for.
 */
export function anchoredAim(events: (FeedEvent & { deleted_at?: string | null })[], plan: FeedingPlan, birthDate: string | null, now: Date = new Date(), opts: { next?: boolean } = {}) {
  const a = plan.anchor!;
  const live = events.filter((e) => !e.deleted_at);
  // `next`: the feed after one still open (the tile's "or next …" line), not the open one itself.
  const open = opts.next ? null : openFeed(live, plan, now);
  const done = feeds(live, plan).filter((f) => f.start <= now && (!open || f.start < open.start));
  const last = done[done.length - 1];
  const next = nextFeed(done, plan, birthDate, now);
  const at = open ? open.start.getTime() : Math.max(next ? next.due.getTime() : now.getTime(), now.getTime());
  const t = new Date(at);
  const each = feedSize(plan, birthDate, t), top = targetAt(plan, birthDate, t)?.max ?? Infinity;
  if (!each) { const f = feedTarget(plan, birthDate, now); return f && { ...f, catchUp: false }; }
  const shape = anchorShape(plan, birthDate, t);
  // A night feed (bedtime, or the one between the night gaps) and a feed after a full gap are a full feed.
  const planned = slotKind(at, a, shape) !== 'day' || !last ? each : each * Math.min(1, (at - last.start.getTime()) / 60_000 / shape.daySpacing);
  const daily = dailyTargetAt(plan, birthDate, new Date(now.getTime() - 12 * 3_600_000));
  const behind = daily ? Math.max(0, daily.min - intakeLast24(live, plan, now)) : 0;
  const c = Math.min(Math.min(top, planned * CATCHUP_MAX_RAISE), planned + behind / 3);
  const max = Math.round(Math.min(top, c * 1.05));
  return { min: Math.min(max, Math.round(c * 0.95)), max, catchUp: c > planned * 1.02 };
}
