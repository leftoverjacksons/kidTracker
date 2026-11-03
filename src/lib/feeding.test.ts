import { describe, expect, it } from 'vitest';
import { ageTarget, aimAt, anchoredGapMin, anchorsAround, feedsPerDay, intakeLast24, planAim, planSlots, feedEveryMin, medianFeedByDay, dailyTargetAt, openFeed, schedule, topUp, DEFAULT_PLAN, feeds, nextFeed, pumpsWithFeeds, readPlan, targetAt } from './feeding';

const at = (hhmm: string) => `2026-10-24T${hhmm}:00`;
const bottle = (start: string, ml: number) => ({ type: 'bottle', started_at: at(start), ended_at: at(start), bottle_ml: ml });
const nurse = (start: string, end: string) => ({ type: 'nursing', started_at: at(start), ended_at: at(end), bottle_ml: null });
const fixed = readPlan({ target: { min_ml: 75, max_ml: 90 }, nursing_ml_per_min: 3, every_min: 180 });

describe('feeding plan', () => {
  it('falls back to the defaults for missing or bad values', () => {
    expect(readPlan(null)).toEqual(DEFAULT_PLAN);
    expect(readPlan({ target: { min_ml: 90, max_ml: 60 }, every_min: 5 })).toEqual(DEFAULT_PLAN);
    expect(fixed.target).toEqual({ min_ml: 75, max_ml: 90 });
  });
  it('age curve: handout ranges at mid-week, straight lines between, flat at the ends', () => {
    expect(ageTarget(3)).toEqual({ min: 45, max: 60 });
    expect(ageTarget(11)).toEqual({ min: 75, max: 90 });
    expect(ageTarget(10)).toEqual({ min: 70, max: 85 });
    expect(ageTarget(18)).toEqual({ min: 105, max: 120 });
    expect(ageTarget(60)).toEqual({ min: 120, max: 150 });
    expect(targetAt(DEFAULT_PLAN, null, new Date())).toBeNull();
    expect(targetAt(fixed, null, new Date())).toEqual({ min: 75, max: 90 });
  });
});

describe('feeds', () => {
  it('groups entries starting within 20 min of the previous one ending, and estimates intake', () => {
    const f = feeds([nurse('11:37', '11:54'), bottle('12:10', 15), bottle('12:20', 25), bottle('15:00', 60)], fixed);
    expect(f).toHaveLength(2);
    expect(f[0]).toMatchObject({ bottleMl: 40, nursingMin: 17, estMl: 91 });
    expect(f[1].estMl).toBe(60);
  });
  it('your two examples are both a full 90 ml feed', () => {
    expect(feeds([nurse('10:00', '10:20'), bottle('10:25', 30)], fixed)[0].estMl).toBe(90);
    expect(feeds([nurse('10:00', '10:10'), bottle('10:15', 60)], fixed)[0].estMl).toBe(90);
  });
});

describe('next feed', () => {
  const now = new Date(at('13:00'));
  const plan = readPlan({ target: { min_ml: 80, max_ml: 100 }, nursing_ml_per_min: 3, every_min: 180 }); // middle 90 ml
  const due = (f: ReturnType<typeof feeds>) => nextFeed(f, plan, null, now)!.due;
  it('the middle of the target buys exactly the interval', () => {
    expect(due(feeds([bottle('12:00', 90)], plan))).toEqual(new Date(at('15:00')));
  });
  it('less brings it closer in proportion', () => {
    expect(due(feeds([bottle('12:00', 60)], plan))).toEqual(new Date(at('14:00')));
  });
  it('more pushes it later in proportion, up to what the top of the target buys', () => {
    expect(due(feeds([bottle('12:00', 100)], plan))).toEqual(new Date(at('15:20')));
    expect(due(feeds([bottle('12:00', 150)], plan))).toEqual(new Date(at('15:20')));
  });
  it('a top-up adds to the time left, within the same cap from the top-up', () => {
    expect(due(feeds([bottle('09:00', 60), bottle('10:00', 30)], plan))).toEqual(new Date(at('12:00')));
    expect(due(feeds([bottle('09:00', 90), bottle('10:00', 90)], plan))).toEqual(new Date(at('13:20')));
  });
  it('a sip after an overdue gap counts from the sip', () => {
    expect(due(feeds([bottle('06:00', 90), bottle('10:00', 30)], plan))).toEqual(new Date(at('11:00')));
  });
  it('averages estimated intake per feed by day', () => {
    const f = feeds([bottle('08:00', 60), bottle('12:00', 90)], fixed);
    expect(medianFeedByDay(f, ['2026-10-23', '2026-10-24'], () => '2026-10-24')).toEqual([null, 75]); // two feeds: the middle of 60 and 90
    // One or two snacks barely move the median; a day of mostly small feeds pulls it down.
    const day = (mls: number[]) => medianFeedByDay(feeds(mls.map((ml, k) => bottle(`${String(1 + k * 2).padStart(2, '0')}:00`, ml)), fixed), ['d'], () => 'd')[0];
    expect(day([85, 90, 80, 85, 82, 88, 80, 45, 40])).toBe(82);
    expect(day([50, 45, 55, 85, 40, 50, 80])).toBe(50);
  });
});

describe('pumps with feeds', () => {
  it('counts pump sessions starting within 30 min of a feed', () => {
    const f = feeds([bottle('09:00', 60), nurse('12:00', '12:20')], fixed);
    const pump = (s: string) => ({ type: 'pump', started_at: at(s), ended_at: at(s) });
    const r = pumpsWithFeeds([pump('08:40'), pump('12:45'), pump('15:00')], f, new Date(at('00:00')));
    expect(r).toEqual({ aligned: 2, total: 3 });
  });
});

describe('pump and feed schedule', () => {
  const now = new Date(at('12:00'));
  const T = (hhmm: string) => new Date(at(hhmm));
  const pump = (last: string, due: string) => ({ last: T(last), due: T(due), side: 'both' as const });
  const next = (due: string) => ({ due: T(due), last: { start: T('09:00'), end: T('09:20'), bottleMl: 90, nursingMin: 0, estMl: 90, ids: [] }, target: null });
  it('pump and next feed within 30 min both move to meet halfway', () => {
    const s = schedule(next('13:00'), pump('10:00', '12:40'), [], now);
    expect(s.feed!.due).toEqual(T('12:50'));
    expect(s.pump!.due).toEqual(T('12:50'));
    expect(s.feed!.withPump && s.pump!.withFeed).toBe(true);
  });
  it('pumping never under 2 h after the last session; the feed meets it there', () => {
    const s = schedule(next('12:10'), pump('10:30', '12:40'), [], now); // halfway 12:25 < floor 12:30
    expect(s.pump!.due).toEqual(T('12:30'));
    expect(s.feed!.due).toEqual(T('12:30'));
  });
  it('more than 30 min apart: nothing moves', () => {
    const s = schedule(next('13:30'), pump('10:00', '12:20'), [], now);
    expect(s.feed!.due).toEqual(T('13:30'));
    expect(s.pump!.due).toEqual(T('12:20'));
    expect(s.pump!.withFeed || s.feed!.withPump).toBe(false);
  });
  it('pump joins a feed that is happening now', () => {
    const s = schedule(next('15:00'), pump('09:30', '12:10'), [T('11:45')], now);
    expect(s.pump!.due).toEqual(T('11:45'));
    expect(s.feed!.due).toEqual(T('15:00'));
  });
  it('no pump reminder: the feed stays as forecast', () => {
    expect(schedule(next('13:00'), null, [], now)).toEqual({ feed: { ...next('13:00'), withPump: false }, pump: null });
  });
});

describe('open feed and top-up', () => {
  const plan = readPlan({ target: { min_ml: 75, max_ml: 90 }, nursing_ml_per_min: 2, every_min: 180 });
  it('a nursing session that ended under 20 min ago is open; its top-up fills the target', () => {
    const f = openFeed([nurse('10:00', '10:15')], plan, new Date(at('10:25')))!;
    expect(f.estMl).toBe(30);
    expect(topUp(f.estMl, { min: 75, max: 90 })).toEqual({ min: 45, max: 60 });
  });
  it('nursing in progress counts up to now; a bottle already given counts too', () => {
    const running = { type: 'nursing', started_at: at('10:00'), ended_at: null, bottle_ml: null };
    expect(openFeed([running], plan, new Date(at('10:10')))!.estMl).toBe(20);
    const f = openFeed([nurse('10:00', '10:15'), bottle('10:20', 40)], plan, new Date(at('10:30')))!;
    expect(f.estMl).toBe(70);
    expect(topUp(f.estMl, { min: 75, max: 90 })).toEqual({ min: 5, max: 20 });
  });
  it('more than 20 min after it ended, nothing is open; a full feed needs no top-up', () => {
    expect(openFeed([nurse('10:00', '10:15')], plan, new Date(at('10:40')))).toBeNull();
    expect(topUp(95, { min: 75, max: 90 })).toEqual({ min: 0, max: 0 });
  });
  it('spacing by age: daily amount ÷ per-feed amount, within 2–4 h', () => {
    const day = (d: number) => new Date(2026, 9, 14 + d);
    expect(feedEveryMin(DEFAULT_PLAN, '2026-10-14', day(11))).toBe(183); // 82.5 of 650 ml
    expect(feedEveryMin(DEFAULT_PLAN, '2026-10-14', day(18))).toBe(203); // 112.5 of 800 ml
    expect(feedEveryMin(DEFAULT_PLAN, '2026-10-14', day(40))).toBe(219); // 135 of 887.5 ml
    expect(feedEveryMin(DEFAULT_PLAN, null, day(11))).toBe(180);
    expect(feedEveryMin(fixed, '2026-10-14', day(11))).toBe(180); // a number is used as is
    expect(readPlan({ every_min: 'age' }).every_min).toBe('age');
  });
  it('by-age spacing moves the next feed', () => {
    const p = readPlan(null), birth = '2026-09-30'; // day 24.5 at noon: 133.5 of 881.5 ml → 3 h 38 m
    const f = feeds([bottle('12:00', 133.5)], p);
    expect(nextFeed(f, p, birth, new Date(at('13:00')))!.due).toEqual(new Date(at('15:38')));
  });
  it('catch-up: a third of the 24 h shortfall raises the bottom of the aim, never past the top', () => {
    const p = readPlan({ target: { min_ml: 75, max_ml: 90 }, nursing_ml_per_min: 3, every_min: 180 }); // daily 600–720
    const now = new Date(at('23:00'));
    const day = (ml: number) => ['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00'].map((t) => bottle(t, ml));
    expect(aimAt(day(80), p, null, now)).toEqual({ min: 75, max: 90, catchUp: false }); // 640 ml: on track
    expect(aimAt(day(72), p, null, now)).toEqual({ min: 83, max: 90, catchUp: true }); // 576: 24 short → +8
    expect(aimAt(day(50), p, null, now)).toEqual({ min: 90, max: 90, catchUp: true }); // 400: capped at the top
  });
  it('catch-up judges the last 24 h against the target at the middle of the window', () => {
    const now = new Date(2026, 9, 29, 22, 0); // day 15.92 for a 2026-10-14 birth
    const mid = dailyTargetAt(DEFAULT_PLAN, '2026-10-14', new Date(2026, 9, 29, 10, 0))!;
    const end = dailyTargetAt(DEFAULT_PLAN, '2026-10-14', now)!;
    expect(end.min).toBeGreaterThan(mid.min);
    const evs = [{ type: 'bottle', started_at: new Date(2026, 9, 29, 12, 0).toISOString(), ended_at: new Date(2026, 9, 29, 12, 0).toISOString(), bottle_ml: mid.min }];
    expect(aimAt(evs, DEFAULT_PLAN, '2026-10-14', now)?.catchUp).toBe(false);
  });
  it('catch-up counts the same 24 h as Reports → Daily, even when a feed straddles the start', () => {
    // Nursing 22:50 the day before (outside), then a 90 ml bottle at 23:05 (inside, same feed).
    const p = readPlan({ target: { min_ml: 75, max_ml: 90 }, nursing_ml_per_min: 3, every_min: 180 });
    const now = new Date(at('23:00'));
    const evs = [
      { type: 'nursing', started_at: '2026-10-23T22:50:00', ended_at: '2026-10-23T23:00:00', bottle_ml: null },
      { type: 'bottle', started_at: '2026-10-23T23:05:00', ended_at: '2026-10-23T23:05:00', bottle_ml: 90 },
      ...['02:00', '05:00', '08:00', '11:00', '14:00', '17:00', '20:00'].map((t) => bottle(t, 80)),
    ];
    expect(intakeLast24(evs, p, now)).toBe(650);
    expect(aimAt(evs, p, null, now)?.catchUp).toBe(false); // 650 ≥ 600: on track
  });
  it('daily target: the handout curve by age, or 8 × the family range', () => {
    expect(dailyTargetAt(DEFAULT_PLAN, '2026-10-14', new Date(2026, 9, 25))).toEqual({ min: 590, max: 710 }); // day 11
    expect(dailyTargetAt(plan, null, new Date())).toEqual({ min: 600, max: 720 });
  });
});

describe('anchored schedule', () => {
  const anchor = { bedtime_min: 23 * 60, night_min: 240, tz: 'America/New_York' };
  const plan = readPlan({ target: { min_ml: 90, max_ml: 110 }, nursing_ml_per_min: 3, every_min: 180, anchor, min_feeds: 8 });
  const Z = (iso: string) => new Date(iso);
  const bottleAt = (iso: string, ml: number) => ({ type: 'bottle', started_at: iso, ended_at: iso, bottle_ml: ml });
  const gapH = (iso: string) => anchoredGapMin(Date.parse(iso), anchor, 8) / 60;

  it('finds the bedtime feed in the household time zone, including across a DST change', () => {
    const { prev, next } = anchorsAround(Date.parse('2026-11-03T12:00:00Z'), anchor); // 7 AM EST
    expect(new Date(prev).toISOString()).toBe('2026-11-03T04:00:00.000Z'); // 11 PM EST the night before
    expect(new Date(next).toISOString()).toBe('2026-11-04T04:00:00.000Z');
    // 2026-11-01 is the fall-back day: 11 PM EDT on Oct 31 is 03:00Z, 11 PM EST on Nov 1 is 04:00Z.
    const dst = anchorsAround(Date.parse('2026-11-01T15:00:00Z'), anchor);
    expect(new Date(dst.prev).toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(new Date(dst.next).toISOString()).toBe('2026-11-02T04:00:00.000Z');
  });
  it('bedtime feed buys the night stretch; the day splits into equal gaps that land on 11 PM', () => {
    expect(gapH('2026-11-03T04:00:00Z')).toBe(4); // 11 PM → 3 AM
    expect(gapH('2026-11-03T04:45:00Z')).toBe(4); // a 11:45 PM feed is still the bedtime feed
    expect(gapH('2026-11-03T08:00:00Z')).toBeCloseTo(20 / 7); // 3 AM: 7 gaps of 2 h 51 m to 11 PM
    expect(gapH('2026-11-03T10:30:00Z')).toBeCloseTo(17.5 / 7); // a late 5:30 AM feed: the rest re-divided, never longer than 2 h 51 m
  });
  it('the evening never gets one long gap, and only a feed from 10 PM is the bedtime feed', () => {
    expect(gapH('2026-11-03T23:45:00Z')).toBeCloseTo(4.25 / 2); // 6:45 PM, 4¼ h left: two gaps, not one of 4¼ h
    expect(gapH('2026-11-04T02:35:00Z')).toBeCloseTo(85 / 60); // 9:35 PM: next at 11 PM, not a night stretch
    expect(gapH('2026-11-04T03:00:00Z')).toBe(4); // 10:00 PM is the bedtime feed
    expect(gapH('2026-11-04T05:20:00Z')).toBeCloseTo(4); // 12:20 AM still is (up to 1½ h after)
  });
  it('next feed: a full feed buys the planned gap, more buys no more, a half feed half', () => {
    const now = Z('2026-11-03T08:30:00Z');
    const aim = planAim(plan, null, now)!; // 8 × 90–110 ml a day ÷ 8 feeds = 100 ml each, ±5%
    expect(aim).toEqual({ min: 95, max: 105 });
    const due = (ml: number) => nextFeed(feeds([bottleAt('2026-11-03T08:00:00Z', ml)], plan), plan, null, now)!.due.getTime();
    const g = (20 / 7) * 3_600_000, t0 = Date.parse('2026-11-03T08:00:00Z');
    expect(due(100)).toBeCloseTo(t0 + g, -3);
    expect(due(140)).toBeCloseTo(t0 + g, -3);
    expect(due(50)).toBeCloseTo(t0 + g / 2, -3);
  });
  it('plans at least the minimum feeds; the slots run from bedtime to bedtime', () => {
    const slots = planSlots(plan, null, Z('2026-11-03T12:00:00Z')).map((d) => d.toISOString().slice(11, 16));
    expect(slots).toEqual(['04:00', '08:00', '10:51', '13:42', '16:34', '19:25', '22:17', '01:08']);
    expect(feedsPerDay(readPlan({ ...plan, min_feeds: 9 }), null, new Date())).toBe(9);
  });
});
