import { describe, expect, it } from 'vitest';
import { averages, completeDays, csvUnits, dayOfLife, diaperGuide, fillDays, longestSleepByDay, toCsv, trimLeading, type DailyRow } from './reports';
import { DEFAULT_SETTINGS } from './types';

describe('reports', () => {
  it('fills missing days with zeros, oldest first, and coerces numeric strings', () => {
    const rows = [{ day: '2026-10-10', bottle_ml: '88.7', feeds: 3 } as unknown as DailyRow];
    const out = fillDays(rows, 3, new Date(2026, 9, 11, 15));
    expect(out.map((r) => r.day)).toEqual(['2026-10-09', '2026-10-10', '2026-10-11']);
    expect(out[1].bottle_ml).toBe(88.7);
    expect(out[0].feeds).toBe(0);
    expect(averages(out).feeds).toBe(1);
  });
  it('trims days before tracking started', () => {
    const rows = fillDays([{ day: '2026-10-10', feeds: 2 } as unknown as DailyRow], 5, new Date(2026, 9, 11));
    const t = trimLeading(rows);
    expect(t.map((r) => r.day)).toEqual(['2026-10-10', '2026-10-11']);
    expect(averages(t).feeds).toBe(1);
    expect(trimLeading(fillDays([], 3, new Date(2026, 9, 11)))).toHaveLength(1);
  });
  it('escapes CSV cells', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'say "hi"'], [null, 3]])).toBe('a,b\r\n"x,y","say ""hi"""\r\n,3\r\n');
  });
  it('converts units for CSV', () => {
    const u = csvUnits(DEFAULT_SETTINGS);
    expect(u.vol(88.7)).toBe(3);
    expect(u.temp(38)).toBe(100.4);
    expect(u.weight(3402)).toEqual([7, 8]);
    expect(u.vol(null)).toBe('');
  });
});

describe('report helpers (round 2)', () => {
  it('drops only today from averages', () => {
    const rows = fillDays([], 3, new Date(2026, 9, 11, 9));
    expect(completeDays(rows, new Date(2026, 9, 11, 9)).map((r) => r.day)).toEqual(['2026-10-09', '2026-10-10']);
    expect(completeDays(rows.slice(-1), new Date(2026, 9, 11, 9))).toHaveLength(1);
    expect(completeDays(rows, new Date(2026, 9, 12))).toHaveLength(3);
  });
  it('counts day of life from the birth date as day 1', () => {
    expect(dayOfLife('2026-10-11', '2026-10-11')).toBe(1);
    expect(dayOfLife('2026-11-01', '2026-10-11')).toBe(22);
  });
  it('gives the newborn diaper guide for the first 14 days', () => {
    expect(diaperGuide('2026-10-11', '2026-10-11')).toEqual({ wet: 1, dirty: 1 });
    expect(diaperGuide('2026-10-14', '2026-10-11')).toEqual({ wet: 4, dirty: 3 });
    expect(diaperGuide('2026-10-20', '2026-10-11')).toEqual({ wet: 6, dirty: 3 });
    expect(diaperGuide('2026-10-25', '2026-10-11')).toBeNull();
    expect(diaperGuide('2026-10-10', '2026-10-11')).toBeNull();
  });
  it('finds the longest sleep per start day', () => {
    const m = longestSleepByDay([
      { start_date: '2026-10-11', duration_min: 90 }, { start_date: '2026-10-11', duration_min: '150' },
      { start_date: '2026-10-12', duration_min: 40 },
    ]);
    expect(m.get('2026-10-11')).toBe(150);
    expect(m.get('2026-10-12')).toBe(40);
  });
});
