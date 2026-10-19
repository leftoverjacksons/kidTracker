import type { EventRow } from './types';

export const PUMP_MIN_MINUTES = 15;
export const PUMP_TARGET = { min: 8, max: 12 };

/**
 * Pumping sessions of at least 15 minutes per breast in the rolling last 24 hours
 * (design doc §8a E3). A "both" session counts for each side. A running session
 * counts once it has reached 15 minutes.
 */
export function pumpCounts(events: EventRow[], now: Date = new Date()): { left: number; right: number } {
  const since = now.getTime() - 86_400_000;
  const out = { left: 0, right: 0 };
  for (const e of events) {
    if (e.type !== 'pump' || e.deleted_at) continue;
    const start = new Date(e.started_at).getTime();
    if (start < since || start > now.getTime()) continue;
    const end = e.ended_at ? new Date(e.ended_at).getTime() : now.getTime();
    if (end - start < PUMP_MIN_MINUTES * 60_000) continue;
    if (e.pump_side === 'left' || e.pump_side === 'both') out.left++;
    if (e.pump_side === 'right' || e.pump_side === 'both') out.right++;
  }
  return out;
}

/** Pumping reminder interval for this phone, in minutes (null = off). 120 min = 12 sessions a day. */
export const PUMP_EVERY_OPTIONS = [120, 150, 180] as const;
const EVERY_KEY = 'kt.pumpEvery';
export function pumpEveryMin(): number | null {
  try {
    const v = localStorage.getItem(EVERY_KEY);
    if (v === 'off') return null;
    return v ? Number(v) : 120;
  } catch { return 120; }
}
export function setPumpEveryMin(v: number | null) {
  try { localStorage.setItem(EVERY_KEY, v == null ? 'off' : String(v)); } catch { /* ignore */ }
}

export interface PumpDue {
  /** When the next session is due (last qualifying session's start + interval). */
  due: Date;
  /** Start of the last 15+ minute session on the side that has waited longest. */
  last: Date;
  /** Which side to pump: both when the two sides' last sessions are within 15 minutes. */
  side: 'left' | 'right' | 'both';
}

/**
 * When the next pumping session is due to keep pace with one every `everyMin` minutes
 * (design doc §8a I). Counts the same sessions as the gauges (15+ minutes, "both" counts
 * for each side). Null while a session is running, when reminders are off, or before any
 * session has been logged.
 */
export function pumpDue(events: EventRow[], now: Date, everyMin: number | null): PumpDue | null {
  if (everyMin == null) return null;
  let left = 0, right = 0;
  for (const e of events) {
    if (e.type !== 'pump' || e.deleted_at) continue;
    if (!e.ended_at) return null; // pumping right now
    const start = new Date(e.started_at).getTime();
    if (start > now.getTime() || new Date(e.ended_at).getTime() - start < PUMP_MIN_MINUTES * 60_000) continue;
    if (e.pump_side === 'left' || e.pump_side === 'both') left = Math.max(left, start);
    if (e.pump_side === 'right' || e.pump_side === 'both') right = Math.max(right, start);
  }
  if (!left && !right) return null;
  // A side never pumped (in the loaded window) is treated as the one waiting longest.
  const l = left || right, r = right || left;
  const last = Math.min(l, r);
  const side = Math.abs(l - r) <= PUMP_MIN_MINUTES * 60_000 && left && right ? 'both' : l < r ? 'left' : 'right';
  return { due: new Date(last + everyMin * 60_000), last: new Date(last), side };
}
