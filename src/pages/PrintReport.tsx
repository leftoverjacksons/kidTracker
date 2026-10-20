import { useEffect, useMemo, useState } from 'react';
import BarChart from '../components/charts/BarChart';
import LineChart from '../components/charts/LineChart';
import { PrintCharts } from '../components/charts/theme';
import WeightChangeChart from '../components/charts/WeightChangeChart';
import { formatDuration, formatLength, formatTemp, formatVolume, formatWeight, startOfDay } from '../lib/format';
import { useHousehold } from '../lib/household';
import { averages, completeDays, dailyCharts, daysOld, fillDays, isoDay, localStamp, longestSleepByDay, shortDay, trimLeading, type DailyRow } from '../lib/reports';
import { supabase } from '../lib/supabase';
import { ageLabel, mlToOz } from '../lib/units';
import { formatPct, weightChange } from '../lib/weight';
import { ageInMonths, percentile, type Measure } from '../lib/who';

type Row = Record<string, unknown>;
type Sleep = { start_date: string; duration_min: number };
type Bottle = { start_date: string; bottle_ml: number | null; bottle_contents: string | null };

const DAY = 86_400_000;
// Module-level so the charts don't redraw on every render.
const fmtCount = (v: number) => String(Math.round(v * 10) / 10);
const fmtHours = (m: number) => (m < 60 ? `${Math.round(m)}m` : `${Math.round((m / 60) * 10) / 10}h`);
const fmtMin = (m: number) => `${Math.round(m)}m`;
const fmtVol = (v: number) => `${Math.round(v * 10) / 10}`;
const NO_PUMPS: never[] = [];

/**
 * Pediatrician summary (Print → Save as PDF). Page 1 is the overview: daily averages,
 * weight change and the main charts (complete days only). The pages after it hold the
 * raw numbers: one row per day, growth, medicines and temperatures.
 */
export default function PrintReport({ days }: { days: number }) {
  const { baby, settings } = useHousehold();
  const [daily, setDaily] = useState<DailyRow[] | null>(null);
  const [growth, setGrowth] = useState<Row[]>([]);
  const [meds, setMeds] = useState<Row[]>([]);
  const [temps, setTemps] = useState<Row[]>([]);
  const [sleeps, setSleeps] = useState<Sleep[]>([]);
  const [bottles, setBottles] = useState<Bottle[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.add('print-mode');
    return () => document.body.classList.remove('print-mode');
  }, []);

  useEffect(() => {
    if (!supabase || !baby) return;
    const from = new Date(startOfDay(new Date()).getTime() - (days - 1) * 86_400_000);
    void (async () => {
      const [d, g, m, t, sl, bo] = await Promise.all([
        supabase!.from('v_daily_summary').select('*').eq('baby_id', baby.id).gte('day', isoDay(from)),
        supabase!.from('v_growth').select('*').eq('baby_id', baby.id).order('started_at'),
        supabase!.from('v_meds').select('*').eq('baby_id', baby.id).gte('started_at', from.toISOString()).order('started_at'), // Mom's filtered below
        supabase!.from('v_temps').select('*').eq('baby_id', baby.id).gte('started_at', from.toISOString()).order('started_at'),
        supabase!.from('v_sleep').select('start_date,duration_min').eq('baby_id', baby.id).gte('start_date', isoDay(from)),
        supabase!.from('v_feeds').select('start_date,bottle_ml,bottle_contents').eq('baby_id', baby.id).eq('feed_type', 'bottle').gte('start_date', isoDay(from)),
      ]);
      const err = d.error ?? g.error ?? m.error ?? t.error;
      if (err) return setError(err.message);
      setDaily(trimLeading(fillDays((d.data ?? []) as DailyRow[], days)));
      setGrowth(g.data ?? []);
      setMeds((m.data ?? []).filter((r) => r.for_whom !== 'mom'));
      setTemps(t.data ?? []);
      setSleeps((sl.data ?? []) as Sleep[]);
      setBottles((bo.data ?? []) as Bottle[]);
    })();
  }, [baby, days]);

  const oz = settings.volume_unit === 'oz';
  const longest = useMemo(() => longestSleepByDay(sleeps), [sleeps]);
  // Charts show complete days only: a half-finished today would look like a drop.
  const charts = useMemo(() => (daily ? dailyCharts(completeDays(daily), {
    sleeps, bottles, pumps: NO_PUMPS, birthDate: baby?.birth_date ?? null,
    toVol: (ml) => (oz ? Math.round(mlToOz(ml) * 10) / 10 : Math.round(ml)),
  }) : null), [daily, sleeps, bottles, baby?.birth_date, oz]);
  const wc = useMemo(() => weightChange(growth as { started_at: string; weight_g: number | null }[]), [growth]);
  const gToUnit = useMemo(() => (g: number) => (settings.weight_unit === 'lb_oz' ? g / 453.59237 : g / 1000), [settings.weight_unit]);
  const fmtGrams = useMemo(() => (g: number) => formatWeight(g, settings), [settings]);

  if (!baby) return null;
  const back = () => { window.location.hash = '#/reports'; };
  if (error) return <div className="print-page"><p>{error}</p><button onClick={back}>Back</button></div>;
  if (!daily || !charts) return <div className="print-page"><p>Loading…</p></div>;

  const full = completeDays(daily);
  const avg = averages(full); // complete days only; today is still in progress
  const today = isoDay(new Date());
  const avgLongest = full.reduce((a, r) => a + (longest.get(r.day) ?? 0), 0) / (full.length || 1);
  const h = (min: number) => formatDuration(min * 60_000);
  const pct = (m: Measure, at: string, v: number) => {
    if (!baby.birth_date || !baby.sex) return '';
    const p = percentile(baby.sex, m, ageInMonths(baby.birth_date, new Date(at)), v);
    return p == null ? '' : ` (${p < 1 ? '<1' : p > 99 ? '>99' : Math.round(p)}th)`;
  };
  const first = daily[0].day, last = daily[daily.length - 1].day;
  const bd = baby.birth_date;
  const birth = bd ? (() => { const [y, m, d] = bd.split('-').map(Number); return new Date(y, m - 1, d).getTime(); })() : null;
  // Day of life (birth date = day 0), as on the weight chart.
  const dol = (t: number) => (bd ? daysOld(isoDay(new Date(t)), bd) : null);
  const onDay = (t: number) => { const n = dol(t); return n == null ? new Date(t).toLocaleDateString() : `day ${n}`; };
  const baseLabel = wc && birth != null && wc.base.t - birth < 2 * DAY ? 'Birth weight' : 'First weight';
  const volUnit = oz ? 'oz' : 'ml';
  const has = charts.has;

  return (
    <PrintCharts.Provider value>
    <div className="print-page">
      <div className="no-print print-actions">
        <button onClick={back}>‹ Back</button>
        <button className="primary" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>

      <h1>{baby.name}</h1>
      <p className="meta">
        {bd && <>Born {new Date(bd + 'T00:00').toLocaleDateString()} · {ageLabel(bd)} · </>}
        Summary of {shortDay(first)} to {shortDay(last)} ({daily.length} day{daily.length === 1 ? '' : 's'}) · generated {new Date().toLocaleString()}
      </p>

      <h2>Daily averages <span className="meta">({full.length} complete day{full.length === 1 ? '' : 's'})</span></h2>
      <div className="table-wrap">
      <table className="kv">
        <tbody>
          <tr><th>Sleep</th><td>{h(avg.sleepMin)}</td><th>Feeds</th><td>{avg.feeds.toFixed(1)}</td></tr>
          <tr><th>Bottle</th><td>{formatVolume(avg.bottleMl, settings)}</td><th>Nursing</th><td>{h(avg.nursingMin)}</td></tr>
          <tr><th>Wet diapers</th><td>{avg.wet.toFixed(1)}</td><th>Dirty diapers</th><td>{avg.dirty.toFixed(1)}</td></tr>
          <tr><th>Longest sleep</th><td>{h(avgLongest)}</td><th>Time between feeds</th><td>{avg.feedIntervalMin ? h(avg.feedIntervalMin) : '–'}</td></tr>
        </tbody>
      </table></div>

      {wc && (
        <>
          <h2>Weight</h2>
          <div className="table-wrap">
          <table className="kv">
            <tbody>
              <tr><th>{baseLabel}</th><td>{formatWeight(wc.base.grams, settings)} <span className="meta">({onDay(wc.base.t)})</span></td>
                <th>Latest</th><td>{formatWeight(wc.latest.grams, settings)} ({formatPct(wc.latest.pct)}){pct('weight', new Date(wc.latest.t).toISOString(), wc.latest.grams / 1000)} <span className="meta">({onDay(wc.latest.t)})</span></td></tr>
              <tr><th>Lowest</th><td>{wc.lowest.pct < 0 ? <>{formatWeight(wc.lowest.grams, settings)} ({formatPct(wc.lowest.pct)}) <span className="meta">({onDay(wc.lowest.t)})</span></> : 'No loss recorded'}</td>
                <th>Back to {baseLabel.toLowerCase()}</th><td>{wc.lowest.pct < 0 ? (wc.regainedAt ? onDay(wc.regainedAt) : 'Not yet') : '–'}</td></tr>
            </tbody>
          </table></div>
        </>
      )}

      <div className="print-charts">
        {wc && wc.points.length > 1 && (
          <WeightChangeChart data={wc} toDisplay={gToUnit} unit={settings.weight_unit === 'lb_oz' ? 'lb' : 'kg'}
            formatWeight={fmtGrams} dayZero={birth ?? new Date(isoDay(new Date(wc.base.t)) + 'T00:00').getTime()} baseLabel={baseLabel} />
        )}
        <LineChart partialLast={charts.partial} integer title="Feeds per day" labels={charts.labels} series={charts.feeds} format={fmtCount} hues={['coral']}
          note="Nursing and bottle; entries under 20 min apart count as one feed." />
        {has('longest_feed_interval_min') && (
          <LineChart partialLast={charts.partial} integer minutesAxis title="Time between feeds" labels={charts.labels} series={charts.feedGap} format={fmtHours} hues={['teal', 'coral']}
            note="Start of one feed to the start of the next." />
        )}
        {has('bottle_ml') && (
          <LineChart partialLast={charts.partial} title={`Bottle per day (${volUnit})`} labels={charts.labels} series={charts.bottle.series} format={fmtVol} hues={['teal', 'blue', 'coral']}
            note={`Amount drunk.${charts.bottle.hasMixed ? ' Mixed bottles count in the total only.' : ''}`} />
        )}
        {(has('nursing_left_min') || has('nursing_right_min')) && (
          <LineChart partialLast={charts.partial} integer stacked title="Nursing minutes per day" labels={charts.labels} series={charts.nursing} format={fmtMin} hues={['blue', 'coral']}
            note="Stacked: the top edge is the total." />
        )}
        <BarChart partialLast={charts.partial} integer title="Diapers per day" labels={charts.labels} series={charts.diapers} format={fmtCount} hues={['blue', 'amber']}
          guides={charts.diaperGuides} note={charts.diaperGuides.length ? 'Guide lines: common first-two-weeks reference (wet ≈ days old up to 6, dirty ≈ days old up to 3).' : undefined} />
        {has('sleep_min') && <LineChart partialLast={charts.partial} integer minutesAxis stacked title="Sleep per day" labels={charts.labels} series={charts.sleep} format={fmtHours} hues={['blue', 'amber']}
          note="Stacked: the top edge is total sleep. Night = sleep starting 7 pm–6 am." />}
      </div>

      <h2 className="print-break">Day by day <span className="meta">(raw numbers)</span></h2>
      <div className="table-wrap">
      <table>
        <thead><tr><th>Date</th>{bd && <th>Day</th>}<th>Sleep</th><th>Night</th><th>Naps</th><th>Longest</th><th>Feeds</th><th>Longest gap</th><th>Nursing L/R</th><th>Bottle</th><th>Wet</th><th>Dirty</th></tr></thead>
        <tbody>
          {daily.map((r) => (
            <tr key={r.day}>
              <td className="nowrap">{shortDay(r.day)}{r.day === today ? ' (so far)' : ''}</td>{bd && <td>{daysOld(r.day, bd)}</td>}<td>{h(r.sleep_min)}</td><td>{h(r.night_sleep_min)}</td><td>{h(r.nap_sleep_min)}</td>
              <td>{longest.get(r.day) ? h(longest.get(r.day)!) : '–'}</td>
              <td>{r.feeds}</td><td>{r.longest_feed_interval_min ? h(r.longest_feed_interval_min) : '–'}</td><td>{r.nursing_left_min}/{r.nursing_right_min} m</td>
              <td>{r.bottle_ml ? formatVolume(r.bottle_ml, settings) : '–'}</td><td>{r.wet_diapers}</td><td>{r.dirty_diapers}</td>
            </tr>
          ))}
        </tbody>
      </table></div>

      {growth.length > 0 && (
        <>
          <h2>Growth{baby.sex ? ' (WHO percentile)' : ''}</h2>
          <div className="table-wrap">
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
          </table></div>
        </>
      )}

      {meds.length > 0 && (
        <>
          <h2>Medicine given</h2>
          <div className="table-wrap">
          <table>
            <thead><tr><th>Time</th><th>Medication</th><th>Dose</th><th>Notes</th></tr></thead>
            <tbody>
              {meds.map((m) => (
                <tr key={String(m.id)}><td>{localStamp(String(m.started_at))}</td><td>{String(m.medication ?? '')}</td>
                  <td>{m.dose_amount != null ? `${m.dose_amount} ${m.dose_unit ?? ''}` : ''}</td><td>{String(m.notes ?? '')}</td></tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}

      {temps.length > 0 && (
        <>
          <h2>Temperatures</h2>
          <div className="table-wrap">
          <table>
            <thead><tr><th>Time</th><th>Temperature</th><th>Method</th><th>Notes</th></tr></thead>
            <tbody>
              {temps.map((t) => (
                <tr key={String(t.id)}><td>{localStamp(String(t.started_at))}</td><td>{formatTemp(Number(t.temp_c), settings)}</td>
                  <td>{String(t.temp_method ?? '')}</td><td>{String(t.notes ?? '')}</td></tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}
      <p className="meta">Recorded by the family with LakTrak. Sleep minutes are split at midnight; "night" = sleep starting 7 pm–6 am.{bd ? ' "Day" = days old, with the birth date as day 0.' : ''}</p>
    </div>
    </PrintCharts.Provider>
  );
}
