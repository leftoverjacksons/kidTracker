import { describe, expect, it } from 'vitest';
import { medStatus } from './meds';
import type { EventRow, Medication } from './types';

const med: Medication = { id: 'm', name: 'Test', default_dose: 1, unit: 'ml', min_interval_hours: 6, max_doses_per_24h: 3, active: true };
const dose = (iso: string) => ({ type: 'medicine', medication_id: 'm', started_at: iso }) as EventRow;

describe('medStatus', () => {
  const now = new Date('2026-10-11T20:00:00Z');
  it('applies the minimum interval', () => {
    const s = medStatus(med, [dose('2026-10-11T17:00:00Z')], now);
    expect(s.nextAllowed?.toISOString()).toBe('2026-10-11T23:00:00.000Z');
    expect(s.dosesLast24h).toBe(1);
  });
  it('applies the 24 h maximum', () => {
    const s = medStatus(med, [dose('2026-10-11T00:00:00Z'), dose('2026-10-11T07:00:00Z'), dose('2026-10-11T13:00:00Z')], now);
    // interval would allow 19:00, but the 3rd-most-recent dose (00:00) must age out: 00:00 + 24h
    expect(s.nextAllowed?.toISOString()).toBe('2026-10-12T00:00:00.000Z');
  });
  it('is null when nothing restricts', () => {
    expect(medStatus({ ...med, min_interval_hours: null, max_doses_per_24h: null }, [dose('2026-10-11T19:00:00Z')], now).nextAllowed).toBeNull();
    expect(medStatus(med, [], now).last).toBeNull();
  });
});
