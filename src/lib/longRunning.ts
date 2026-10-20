import type { EventRow, TimedType } from './types';

/** Minutes after which a running timer gets a "still running?" check (design doc §8a E5). */
export const STILL_RUNNING_MIN: Record<TimedType, number> = { sleep: 240, nursing: 60, pump: 30, tummy_time: 30, bottle: 45 };

/** Snoozes per phone: event id → time (ms) until which the check stays hidden. */
export type Snoozes = Record<string, number>;
const KEY = 'kt.stillRunning';

export function loadSnoozes(): Snoozes {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Snoozes; } catch { return {}; }
}

/** Snooze `id` for one more threshold interval; drops snoozes of timers no longer running. */
export function snooze(s: Snoozes, e: EventRow, now: Date, runningIds: string[]): Snoozes {
  const next: Snoozes = {};
  for (const id of runningIds) if (s[id] && id !== e.id) next[id] = s[id];
  next[e.id] = now.getTime() + STILL_RUNNING_MIN[e.type as TimedType] * 60_000;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

/** Running timers past their threshold and not snoozed, longest-running first. */
export function overdue(running: Partial<Record<TimedType, EventRow>>, now: Date, snoozes: Snoozes): EventRow[] {
  return (Object.values(running) as EventRow[])
    .filter((e) => {
      const limit = STILL_RUNNING_MIN[e.type as TimedType];
      if (!limit || e.ended_at) return false;
      const ms = now.getTime() - new Date(e.started_at).getTime();
      return ms >= limit * 60_000 && (snoozes[e.id] ?? 0) <= now.getTime();
    })
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
}
