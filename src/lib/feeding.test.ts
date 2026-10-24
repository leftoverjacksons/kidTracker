import { describe, expect, it } from 'vitest';
import { ageTarget, averageFeedByDay, schedule, DEFAULT_PLAN, feeds, nextFeed, pumpsWithFeeds, readPlan, targetAt } from './feeding';

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
    expect(averageFeedByDay(f, ['2026-10-23', '2026-10-24'], () => '2026-10-24')).toEqual([null, 75]);
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
  const next = (due: string) => ({ due: T(due), last: { start: T('09:00'), end: T('09:20'), bottleMl: 90, nursingMin: 0, estMl: 90 }, target: null });
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
