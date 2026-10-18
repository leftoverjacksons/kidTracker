import { csvUnits, download, isoDay, localStamp, toCsv } from './reports';
import { startOfDay } from './format';
import { supabase } from './supabase';
import type { Baby, HouseholdSettings } from './types';

export type ExportKey = 'daily' | 'sleep' | 'feeds' | 'diapers' | 'pumps' | 'meds' | 'temps' | 'growth';

export const EXPORTS: { key: ExportKey; label: string; description: string }[] = [
  { key: 'daily', label: 'Daily summary', description: 'One row per day: sleep, feeds, diapers, pumping' },
  { key: 'sleep', label: 'Sleep', description: 'Every sleep with start, end, nap/night' },
  { key: 'feeds', label: 'Feeds', description: 'Nursing (minutes per side) and bottles' },
  { key: 'diapers', label: 'Diapers', description: 'Wet/dirty, color, consistency, rash' },
  { key: 'pumps', label: 'Pumping', description: 'Sessions with amounts per side' },
  { key: 'meds', label: 'Medicine', description: 'Every dose given' },
  { key: 'temps', label: 'Temperature', description: 'Every reading' },
  { key: 'growth', label: 'Growth', description: 'All measurements (whole history)' },
];

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? '' : String(v));

/** Build and download one CSV. Returns an error message, or null on success. */
export async function runExport(
  key: ExportKey, baby: Baby, settings: HouseholdSettings, days: number,
  names: Record<string, string>,
): Promise<string | null> {
  if (!supabase) return 'Not configured';
  const u = csvUnits(settings);
  const fromDate = new Date(startOfDay(new Date()).getTime() - (days - 1) * 86_400_000);
  const fromDay = isoDay(fromDate);
  const who = (r: Row) => names[s(r.created_by)] ?? '';
  const fetch = async (view: string, dateCol: string, from: string | null) => {
    let q = supabase!.from(view).select('*').eq('baby_id', baby.id).order(dateCol);
    if (from) q = q.gte(dateCol, from);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as Row[];
  };

  try {
    let header: string[];
    let rows: unknown[][];
    switch (key) {
      case 'daily': {
        const d = await fetch('v_daily_summary', 'day', fromDay);
        header = ['date', 'sleep_hours', 'night_sleep_hours', 'nap_hours', 'feeds', 'nursing_sessions',
          'nursing_left_min', 'nursing_right_min', 'bottles', `bottle_${u.volHeader}`, 'diapers', 'wet', 'dirty',
          `pumped_${u.volHeader}`, 'tummy_time_min', 'med_doses', 'avg_hours_between_feeds', 'longest_hours_between_feeds'];
        const h = (m: unknown) => Math.round((Number(m) / 60) * 10) / 10;
        rows = d.map((r) => [r.day, h(r.sleep_min), h(r.night_sleep_min), h(r.nap_sleep_min), r.feeds, r.nursing_sessions,
          r.nursing_left_min, r.nursing_right_min, r.bottles, u.vol(r.bottle_ml as number), r.diapers, r.wet_diapers,
          r.dirty_diapers, u.vol(r.pump_ml as number), r.tummy_min, r.med_doses,
          r.avg_feed_interval_min == null ? '' : h(r.avg_feed_interval_min), r.longest_feed_interval_min == null ? '' : h(r.longest_feed_interval_min)]);
        break;
      }
      case 'sleep': {
        const d = await fetch('v_sleep', 'started_at', fromDate.toISOString());
        header = ['start', 'end', 'duration_min', 'kind', 'notes', 'logged_by'];
        rows = d.map((r) => [localStamp(s(r.started_at)), localStamp(s(r.ended_at)), r.duration_min, r.kind, r.notes, who(r)]);
        break;
      }
      case 'feeds': {
        const d = await fetch('v_feeds', 'started_at', fromDate.toISOString());
        header = ['start', 'type', 'left_min', 'right_min', `bottle_${u.volHeader}`, 'bottle_contents', 'notes', 'logged_by'];
        rows = d.map((r) => [localStamp(s(r.started_at)), r.feed_type, r.left_min, r.right_min,
          u.vol(r.bottle_ml as number), s(r.bottle_contents).replace('_', ' '), r.notes, who(r)]);
        break;
      }
      case 'diapers': {
        const d = await fetch('v_diapers', 'started_at', fromDate.toISOString());
        header = ['time', 'wet', 'dirty', 'color', 'consistency', 'rash', 'notes', 'logged_by'];
        rows = d.map((r) => [localStamp(s(r.started_at)), r.wet ? 'yes' : 'no', r.dirty ? 'yes' : 'no',
          r.poop_color, r.poop_consistency, r.rash ? 'yes' : '', r.notes, who(r)]);
        break;
      }
      case 'pumps': {
        const d = await fetch('v_pumps', 'started_at', fromDate.toISOString());
        header = ['start', 'end', 'duration_min', 'side', `left_${u.volHeader}`, `right_${u.volHeader}`, `total_${u.volHeader}`, 'notes', 'logged_by'];
        rows = d.map((r) => [localStamp(s(r.started_at)), localStamp(s(r.ended_at)), r.duration_min, r.pump_side,
          u.vol(r.pump_left_ml as number), u.vol(r.pump_right_ml as number), u.vol(r.total_ml as number), r.notes, who(r)]);
        break;
      }
      case 'meds': {
        // Mom's medicines (migration 0005) are not the baby's and stay out of the export.
        const d = (await fetch('v_meds', 'started_at', fromDate.toISOString())).filter((r) => r.for_whom !== 'mom');
        header = ['time', 'medication', 'dose', 'unit', 'notes', 'logged_by'];
        rows = d.map((r) => [localStamp(s(r.started_at)), r.medication, r.dose_amount, r.dose_unit, r.notes, who(r)]);
        break;
      }
      case 'temps': {
        const d = await fetch('v_temps', 'started_at', fromDate.toISOString());
        header = ['time', `temp_${u.tempHeader}`, 'method', 'notes', 'logged_by'];
        rows = d.map((r) => [localStamp(s(r.started_at)), u.temp(r.temp_c as number), r.temp_method, r.notes, who(r)]);
        break;
      }
      case 'growth': {
        const d = await fetch('v_growth', 'started_at', null);
        header = ['date', ...u.weightHeaders, `length_${u.lenHeader}`, `head_${u.lenHeader}`, 'notes', 'logged_by'];
        rows = d.map((r) => [s(r.measured_on), ...u.weight(r.weight_g as number), u.len(r.length_cm as number), u.len(r.head_cm as number), r.notes, who(r)]);
        break;
      }
    }
    const name = `${baby.name.replace(/[^\w-]+/g, '_')}-${key}-${isoDay(new Date())}.csv`;
    download(name, toCsv(header, rows as never));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
