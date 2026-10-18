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
