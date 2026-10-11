import { useEffect, useState } from 'react';
import { formatDuration, formatLength, formatTemp, formatVolume, formatWeight, startOfDay } from '../lib/format';
import { useHousehold } from '../lib/household';
import { averages, fillDays, isoDay, localStamp, shortDay, trimLeading, type DailyRow } from '../lib/reports';
import { supabase } from '../lib/supabase';
import { ageLabel } from '../lib/units';
import { ageInMonths, percentile, type Measure } from '../lib/who';

type Row = Record<string, unknown>;

/** One-page pediatrician summary; plain HTML so it prints cleanly (Print → Save as PDF). */
export default function PrintReport({ days }: { days: number }) {
  const { baby, settings } = useHousehold();
  const [daily, setDaily] = useState<DailyRow[] | null>(null);
  const [growth, setGrowth] = useState<Row[]>([]);
  const [meds, setMeds] = useState<Row[]>([]);
  const [temps, setTemps] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.add('print-mode');
    return () => document.body.classList.remove('print-mode');
  }, []);

  useEffect(() => {
    if (!supabase || !baby) return;
    const from = new Date(startOfDay(new Date()).getTime() - (days - 1) * 86_400_000);
    void (async () => {
      const [d, g, m, t] = await Promise.all([
        supabase!.from('v_daily_summary').select('*').eq('baby_id', baby.id).gte('day', isoDay(from)),
        supabase!.from('v_growth').select('*').eq('baby_id', baby.id).order('started_at'),
        supabase!.from('v_meds').select('*').eq('baby_id', baby.id).gte('started_at', from.toISOString()).order('started_at'),
        supabase!.from('v_temps').select('*').eq('baby_id', baby.id).gte('started_at', from.toISOString()).order('started_at'),
      ]);
      const err = d.error ?? g.error ?? m.error ?? t.error;
      if (err) return setError(err.message);
      setDaily(trimLeading(fillDays((d.data ?? []) as DailyRow[], days)));
      setGrowth(g.data ?? []);
      setMeds(m.data ?? []);
      setTemps(t.data ?? []);
    })();
  }, [baby, days]);

  if (!baby) return null;
  const back = () => { window.location.hash = '#/reports'; };
  if (error) return <div className="print-page"><p>{error}</p><button onClick={back}>Back</button></div>;
  if (!daily) return <div className="print-page"><p>Loading…</p></div>;

  const avg = averages(daily);
  const h = (min: number) => formatDuration(min * 60_000);
  const pct = (m: Measure, at: string, v: number) => {
    if (!baby.birth_date || !baby.sex) return '';
    const p = percentile(baby.sex, m, ageInMonths(baby.birth_date, new Date(at)), v);
    return p == null ? '' : ` (${p < 1 ? '<1' : p > 99 ? '>99' : Math.round(p)}th)`;
  };
  const first = daily[0].day, last = daily[daily.length - 1].day;

  return (
    <div className="print-page">
      <div className="no-print print-actions">
        <button onClick={back}>‹ Back</button>
        <button className="primary" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>

      <h1>{baby.name}</h1>
      <p className="meta">
        {baby.birth_date && <>Born {new Date(baby.birth_date + 'T00:00').toLocaleDateString()} · {ageLabel(baby.birth_date)} · </>}
        Summary of {shortDay(first)} to {shortDay(last)} ({daily.length} day{daily.length === 1 ? '' : 's'}) · generated {new Date().toLocaleString()}
      </p>

      <h2>Daily averages</h2>
      <table className="kv">
        <tbody>
          <tr><th>Sleep</th><td>{h(avg.sleepMin)}</td><th>Feeds</th><td>{avg.feeds.toFixed(1)}</td></tr>
          <tr><th>Bottle</th><td>{formatVolume(avg.bottleMl, settings)}</td><th>Nursing</th><td>{h(avg.nursingMin)}</td></tr>
          <tr><th>Wet diapers</th><td>{avg.wet.toFixed(1)}</td><th>Dirty diapers</th><td>{avg.dirty.toFixed(1)}</td></tr>
        </tbody>
      </table>

      <h2>By day</h2>
      <table>
        <thead><tr><th>Date</th><th>Sleep</th><th>Night</th><th>Naps</th><th>Feeds</th><th>Nursing L/R</th><th>Bottle</th><th>Wet</th><th>Dirty</th></tr></thead>
        <tbody>
          {daily.map((r) => (
            <tr key={r.day}>
              <td className="nowrap">{shortDay(r.day)}</td><td>{h(r.sleep_min)}</td><td>{h(r.night_sleep_min)}</td><td>{h(r.nap_sleep_min)}</td>
              <td>{r.feeds}</td><td>{r.nursing_left_min}/{r.nursing_right_min} m</td>
              <td>{r.bottle_ml ? formatVolume(r.bottle_ml, settings) : '–'}</td><td>{r.wet_diapers}</td><td>{r.dirty_diapers}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {growth.length > 0 && (
        <>
          <h2>Growth{baby.sex ? ' (WHO percentile)' : ''}</h2>
          <table>
            <thead><tr><th>Date</th><th>Weight</th><th>Length</th><th>Head</th></tr></thead>
            <tbody>
              {growth.map((g) => (
                <tr key={String(g.id)}>
                  <td>{String(g.measured_on)}</td>
                  <td>{g.weight_g != null ? formatWeight(Number(g.weight_g), settings) + pct('weight', String(g.started_at), Number(g.weight_g) / 1000) : '–'}</td>
                  <td>{g.length_cm != null ? formatLength(Number(g.length_cm), settings) + pct('length', String(g.started_at), Number(g.length_cm)) : '–'}</td>
                  <td>{g.head_cm != null ? formatLength(Number(g.head_cm), settings) + pct('head', String(g.started_at), Number(g.head_cm)) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {meds.length > 0 && (
        <>
          <h2>Medicine given</h2>
          <table>
            <thead><tr><th>Time</th><th>Medication</th><th>Dose</th><th>Notes</th></tr></thead>
            <tbody>
              {meds.map((m) => (
                <tr key={String(m.id)}><td>{localStamp(String(m.started_at))}</td><td>{String(m.medication ?? '')}</td>
                  <td>{m.dose_amount != null ? `${m.dose_amount} ${m.dose_unit ?? ''}` : ''}</td><td>{String(m.notes ?? '')}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {temps.length > 0 && (
        <>
          <h2>Temperatures</h2>
          <table>
            <thead><tr><th>Time</th><th>Temperature</th><th>Method</th><th>Notes</th></tr></thead>
            <tbody>
              {temps.map((t) => (
                <tr key={String(t.id)}><td>{localStamp(String(t.started_at))}</td><td>{formatTemp(Number(t.temp_c), settings)}</td>
                  <td>{String(t.temp_method ?? '')}</td><td>{String(t.notes ?? '')}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="meta">Recorded by the family with kidTracker. Sleep minutes are split at midnight; "night" = sleep starting 7 pm–6 am.</p>
    </div>
  );
}
