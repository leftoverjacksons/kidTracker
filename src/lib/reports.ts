import { startOfDay } from './format';
import type { HouseholdSettings } from './types';
import { cmToIn, cToF, gToLbOz, mlToOz } from './units';

/** One row of v_daily_summary. */
export interface DailyRow {
  day: string; // YYYY-MM-DD
  sleep_min: number; night_sleep_min: number; nap_sleep_min: number; sleeps: number;
  nursing_sessions: number; nursing_left_min: number; nursing_right_min: number;
  bottles: number; bottle_ml: number; feeds: number;
  diapers: number; wet_diapers: number; dirty_diapers: number;
  pump_ml: number; tummy_min: number; med_doses: number;
  // Added by migration 0004 (0 when there's no previous feed yet).
  feed_entries: number; avg_feed_interval_min: number; longest_feed_interval_min: number;
}

const ZERO: Omit<DailyRow, 'day'> = {
  sleep_min: 0, night_sleep_min: 0, nap_sleep_min: 0, sleeps: 0, nursing_sessions: 0, nursing_left_min: 0,
  nursing_right_min: 0, bottles: 0, bottle_ml: 0, feeds: 0, diapers: 0, wet_diapers: 0, dirty_diapers: 0,
  pump_ml: 0, tummy_min: 0, med_doses: 0, feed_entries: 0, avg_feed_interval_min: 0, longest_feed_interval_min: 0,
};

export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The last `n` local days ending today, oldest first, with missing days as zeros. */
export function fillDays(rows: DailyRow[], n: number, today: Date = new Date()): DailyRow[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: DailyRow[] = [];
  const t = startOfDay(today);
  for (let i = n - 1; i >= 0; i--) {
    const day = isoDay(new Date(t.getFullYear(), t.getMonth(), t.getDate() - i));
    const r = byDay.get(day);
    out.push(r ? { ...ZERO, ...numeric(r), day } : { ...ZERO, day });
  }
  return out;
}

// PostgREST returns numeric columns as strings; coerce.
function numeric(r: DailyRow): DailyRow {
  const o = { ...r } as Record<string, unknown>;
  for (const k of Object.keys(ZERO)) o[k] = Number(o[k] ?? 0);
  return o as unknown as DailyRow;
}

/** Drop leading days before anything was logged (keeps at least the last day), so averages ignore them. */
export function trimLeading(rows: DailyRow[]): DailyRow[] {
  const active = (r: DailyRow) => Object.keys(ZERO).some((k) => Number(r[k as keyof DailyRow]) > 0);
  const i = rows.findIndex(active);
  return i < 0 ? rows.slice(-1) : rows.slice(i);
}

/** "Mon 9/28" from YYYY-MM-DD. */
export function shortDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short' })} ${m}/${d}`;
}

/** Averages per day across the given rows. */
export function averages(rows: DailyRow[]) {
  const n = rows.length || 1;
  const sum = (k: keyof Omit<DailyRow, 'day'>) => rows.reduce((a, r) => a + r[k], 0);
  return {
    sleepMin: sum('sleep_min') / n, feeds: sum('feeds') / n, bottleMl: sum('bottle_ml') / n,
    wet: sum('wet_diapers') / n, dirty: sum('dirty_diapers') / n, pumpMl: sum('pump_ml') / n,
    nursingMin: (sum('nursing_left_min') + sum('nursing_right_min')) / n, tummyMin: sum('tummy_min') / n,
    feedIntervalMin: feedInterval(rows),
  };
}

/** Typical start-to-start time between feeds: daily averages weighted by that day's feeds. */
export function feedInterval(rows: DailyRow[]): number {
  const days = rows.filter((r) => r.avg_feed_interval_min > 0 && r.feeds > 0);
  const w = days.reduce((a, r) => a + r.feeds, 0);
  return w ? days.reduce((a, r) => a + r.avg_feed_interval_min * r.feeds, 0) / w : 0;
}

// ───────────── CSV ─────────────

export function toCsv(header: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const cell = (v: string | number | boolean | null | undefined) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Local "YYYY-MM-DD HH:mm" (spreadsheets parse this). */
export function localStamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${isoDay(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Unit converters for CSV columns, following the household display units. */
export function csvUnits(s: HouseholdSettings) {
  const oz = s.volume_unit === 'oz';
  return {
    volHeader: oz ? 'oz' : 'ml',
    vol: (ml: number | string | null | undefined) => (ml == null || ml === '' ? '' : r1(oz ? mlToOz(Number(ml)) : Number(ml))),
    tempHeader: s.temp_unit === 'F' ? 'F' : 'C',
    temp: (c: number | string | null | undefined) => (c == null ? '' : r1(s.temp_unit === 'F' ? cToF(Number(c)) : Number(c))),
    lenHeader: s.length_unit,
    len: (cm: number | string | null | undefined) => (cm == null ? '' : r1(s.length_unit === 'in' ? cmToIn(Number(cm)) : Number(cm))),
    weightHeaders: s.weight_unit === 'lb_oz' ? ['weight_lb', 'weight_oz'] : ['weight_kg'],
    weight: (g: number | string | null | undefined): (number | string)[] => {
      if (g == null) return s.weight_unit === 'lb_oz' ? ['', ''] : [''];
      if (s.weight_unit === 'kg') return [Math.round(Number(g)) / 1000];
      const { lb, oz } = gToLbOz(Number(g));
      return [lb, oz];
    },
  };
}

/** Save text as a file on the phone. */
export function download(filename: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Rows without today's unfinished day (keeps at least one row). */
export function completeDays(rows: DailyRow[], today: Date = new Date()): DailyRow[] {
  const t = isoDay(today);
  return rows.length > 1 && rows[rows.length - 1].day === t ? rows.slice(0, -1) : rows;
}

/** Days old on a calendar day: the birth date is day 0 (same convention as the weight chart). */
export function daysOld(day: string, birthDate: string): number {
  const [y1, m1, d1] = day.split('-').map(Number), [y0, m0, d0] = birthDate.split('-').map(Number);
  return Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y0, m0 - 1, d0)) / 86_400_000);
}

/**
 * Common newborn diaper reference used on hospital/pediatric handouts, counting the
 * birth date as day 0: wet ≈ days old up to 6+, dirty ≈ days old up to 3+.
 * Shown from the birth date through day 14; null outside that.
 */
export function diaperGuide(day: string, birthDate: string): { wet: number; dirty: number } | null {
  const d = daysOld(day, birthDate);
  if (d < 0 || d > 14) return null;
  return { wet: Math.min(d, 6), dirty: Math.min(d, 3) };
}

/** Longest single sleep (minutes) per day, by the day it started. */
export function longestSleepByDay(sleeps: { start_date: string; duration_min: number | string | null }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of sleeps) {
    const m = Number(s.duration_min ?? 0);
    if (m > (out.get(s.start_date) ?? 0)) out.set(s.start_date, m);
  }
  return out;
}

/** Millilitres pumped per breast for each day in `days` (YYYY-MM-DD), 0 where nothing was pumped. */
export function pumpBySide(rows: { start_date: string; pump_left_ml: number | string | null; pump_right_ml: number | string | null }[], days: string[]) {
  const left = new Map<string, number>(), right = new Map<string, number>();
  for (const r of rows) {
    left.set(r.start_date, (left.get(r.start_date) ?? 0) + Number(r.pump_left_ml ?? 0));
    right.set(r.start_date, (right.get(r.start_date) ?? 0) + Number(r.pump_right_ml ?? 0));
  }
  return { left: days.map((d) => left.get(d) ?? 0), right: days.map((d) => right.get(d) ?? 0) };
}

/**
 * Bottle millilitres per day split by contents, for `days` (YYYY-MM-DD). Mixed bottles
 * count only toward the total.
 */
export function bottleByContents(rows: { start_date: string; bottle_ml: number | string | null; bottle_contents: string | null }[], days: string[]) {
  const sum = (kind: string | null) => {
    const m = new Map<string, number>();
    for (const r of rows) if (kind == null || r.bottle_contents === kind) m.set(r.start_date, (m.get(r.start_date) ?? 0) + Number(r.bottle_ml ?? 0));
    return days.map((d) => m.get(d) ?? 0);
  };
  return { total: sum(null), breastMilk: sum('breast_milk'), formula: sum('formula'), hasMixed: rows.some((r) => r.bottle_contents === 'mixed' && Number(r.bottle_ml) > 0) };
}
