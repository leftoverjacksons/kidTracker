import type { EventRow, Medication } from './types';

export interface MedStatus {
  last: Date | null;
  dosesLast24h: number;
  /** When the configured minimum interval / daily maximum next allows a dose; null = no limit set or already allowed. */
  nextAllowed: Date | null;
}

/** Arithmetic on the user's own configured limits (not dosing advice). */
export function medStatus(med: Medication, events: EventRow[], now: Date = new Date()): MedStatus {
  const doses = events
    .filter((e) => e.type === 'medicine' && e.medication_id === med.id)
    .map((e) => new Date(e.started_at))
    .sort((a, b) => b.getTime() - a.getTime());
  const last = doses[0] ?? null;
  const dayAgo = now.getTime() - 86_400_000;
  const recent = doses.filter((d) => d.getTime() > dayAgo);

  let next = 0;
  if (last && med.min_interval_hours) next = last.getTime() + med.min_interval_hours * 3_600_000;
  if (med.max_doses_per_24h && recent.length >= med.max_doses_per_24h) {
    // The oldest dose in the window must drop out first.
    const oldest = recent[med.max_doses_per_24h - 1] ?? recent[recent.length - 1];
    next = Math.max(next, oldest.getTime() + 86_400_000);
  }
  return { last, dosesLast24h: recent.length, nextAllowed: next > now.getTime() ? new Date(next) : null };
}
