import { formatDuration, formatLength, formatTemp, formatVolume, formatWeight } from './format';
import { sideTotals } from './nursing';
import type { EventRow, EventType, HouseholdSettings, Medication } from './types';

export const META: Record<EventType, { emoji: string; label: string }> = {
  sleep: { emoji: '😴', label: 'Sleep' },
  nursing: { emoji: '🤱', label: 'Nurse' },
  bottle: { emoji: '🍼', label: 'Bottle' },
  diaper: { emoji: '🧷', label: 'Diaper' },
  pump: { emoji: '🥛', label: 'Pump' },
  medicine: { emoji: '💊', label: 'Meds' },
  temperature: { emoji: '🌡️', label: 'Temp' },
  growth: { emoji: '📏', label: 'Growth' },
  tummy_time: { emoji: '🧸', label: 'Tummy time' },
  bath: { emoji: '🛁', label: 'Bath' },
  note: { emoji: '📝', label: 'Note' },
};

const CONTENTS: Record<string, string> = { breast_milk: 'breast milk', formula: 'formula', mixed: 'mixed' };

export function diaperLabel(e: Pick<EventRow, 'diaper_wet' | 'diaper_dirty'>): string {
  if (e.diaper_wet && e.diaper_dirty) return 'Wet + dirty';
  if (e.diaper_dirty) return 'Dirty';
  if (e.diaper_wet) return 'Wet';
  return 'Dry';
}

/** One-line summary of an event, e.g. "3 oz formula", "L 8m · R 6m". */
export function summarize(e: EventRow, s: HouseholdSettings, meds: Medication[], now = new Date()): string {
  const dur = e.ended_at
    ? formatDuration(new Date(e.ended_at).getTime() - new Date(e.started_at).getTime())
    : 'in progress';
  const parts: string[] = [];
  switch (e.type) {
    case 'sleep':
    case 'tummy_time':
      parts.push(dur);
      break;
    case 'nursing': {
      const t = sideTotals(e.nursing_segments ?? [], now);
      if (t.left) parts.push(`L ${formatDuration(t.left)}`);
      if (t.right) parts.push(`R ${formatDuration(t.right)}`);
      if (!e.ended_at) parts.push('in progress');
      break;
    }
    case 'bottle':
      parts.push([formatVolume(e.bottle_ml, s), e.bottle_contents && CONTENTS[e.bottle_contents]].filter(Boolean).join(' '));
      break;
    case 'diaper':
      parts.push(diaperLabel(e));
      if (e.poop_color) parts.push(e.poop_color);
      if (e.poop_consistency) parts.push(e.poop_consistency);
      if (e.diaper_rash) parts.push('rash');
      break;
    case 'pump': {
      const total = (e.pump_left_ml ?? 0) + (e.pump_right_ml ?? 0);
      if (e.pump_side) parts.push({ left: 'Left', right: 'Right', both: 'Both' }[e.pump_side]);
      if (total) parts.push(formatVolume(total, s));
      parts.push(dur);
      break;
    }
    case 'medicine': {
      const med = meds.find((m) => m.id === e.medication_id);
      parts.push([med?.for_whom === 'mom' ? `Mom · ${med.name}` : med?.name ?? 'Medicine', e.dose_amount != null ? `${e.dose_amount}${e.dose_unit ? ' ' + e.dose_unit : ''}` : ''].filter(Boolean).join(' '));
      break;
    }
    case 'temperature':
      parts.push([formatTemp(e.temp_c, s), e.temp_method].filter(Boolean).join(' '));
      break;
    case 'growth':
      parts.push(...[formatWeight(e.weight_g, s), formatLength(e.length_cm, s), e.head_cm != null ? `head ${formatLength(e.head_cm, s)}` : ''].filter(Boolean));
      break;
    case 'bath':
      if (e.ended_at && e.ended_at !== e.started_at) parts.push(dur);
      break;
  }
  return parts.filter(Boolean).join(' · ');
}
