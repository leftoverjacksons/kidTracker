import { activeSide } from './nursing';
import type { EventRow } from './types';

/**
 * Which running timers an action ends (design doc §8a E1).
 * Actions are things logged or started "now"; unrelated actions never interrupt each other.
 */
export type Action =
  | { kind: 'start_sleep' }
  | { kind: 'start_nursing'; side: 'left' | 'right' }
  | { kind: 'switch_nursing'; side: 'left' | 'right' }
  | { kind: 'bottle' }
  | { kind: 'diaper' }
  | { kind: 'start_tummy' }
  | { kind: 'bath' }
  | { kind: 'start_pump'; side: 'left' | 'right' | 'both' };

const uses = (pumpSide: string | null, side: 'left' | 'right') => pumpSide === side || pumpSide === 'both';

/** Running entries that `action` should end. `running` = entries with no end time. */
export function conflictsFor(action: Action, running: EventRow[]): EventRow[] {
  const out: EventRow[] = [];
  for (const e of running) {
    if (e.ended_at) continue;
    switch (e.type) {
      case 'sleep':
        if (['start_nursing', 'bottle', 'diaper', 'start_tummy', 'bath'].includes(action.kind)) out.push(e);
        break;
      case 'nursing':
        if (action.kind === 'bottle' || action.kind === 'start_sleep') out.push(e);
        if (action.kind === 'start_pump') {
          const side = activeSide(e.nursing_segments ?? []);
          if (side && (action.side === 'both' || action.side === side)) out.push(e);
        }
        break;
      case 'tummy_time':
        if (action.kind === 'start_sleep') out.push(e);
        break;
      case 'pump':
        if ((action.kind === 'start_nursing' || action.kind === 'switch_nursing') && uses(e.pump_side, action.side)) out.push(e);
        break;
    }
  }
  return out;
}

/** True when an entry timed `at` counts as "now" (back-dated entries never stop timers). */
export function isNow(at: Date, now: Date = new Date()): boolean {
  return Math.abs(now.getTime() - at.getTime()) <= 5 * 60_000;
}
