import {
  IonButton, IonContent, IonHeader, IonItem, IonLabel, IonList, IonListHeader, IonPage, IonRefresher,
  IonRefresherContent, IonSegment, IonSegmentButton, IonSpinner, IonTitle, IonToolbar, useIonToast,
} from '@ionic/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import BarChart from '../components/charts/BarChart';
import LineChart from '../components/charts/LineChart';
import GrowthChart from '../components/charts/GrowthChart';
import WeightChangeChart from '../components/charts/WeightChangeChart';
import { weightChange } from '../lib/weight';
import { useData } from '../lib/data';
import { formatDuration, formatLength, formatVolume, formatWeight, startOfDay } from '../lib/format';
import { useHousehold } from '../lib/household';
import { averages, completeDays, diaperGuide, fillDays, isoDay, longestSleepByDay, pumpBySide, trimLeading, type DailyRow } from '../lib/reports';
import { EXPORTS, runExport } from '../lib/exports';
import { supabase } from '../lib/supabase';
import { cmToIn, mlToOz } from '../lib/units';
import { ageInMonths, percentile, type Measure } from '../lib/who';

export interface GrowthRow { started_at: string; weight_g: number | null; length_cm: number | null; head_cm: number | null }

export default function Reports() {
  const { baby, settings, me } = useHousehold();
  const data = useData();
  const [toast] = useIonToast();
  const [days, setDays] = useState(14);
  const [rows, setRows] = useState<DailyRow[] | null>(null);
  const [growth, setGrowth] = useState<GrowthRow[]>([]);
  const [sleeps, setSleeps] = useState<{ start_date: string; duration_min: number }[]>([]);
  const [pumps, setPumps] = useState<{ start_date: string; pump_left_ml: number | null; pump_right_ml: number | null }[]>([]);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    if (!supabase || !baby) return;
    const from = isoDay(new Date(startOfDay(new Date()).getTime() - (days - 1) * 86_400_000));
    const [d, g, sl, pu] = await Promise.all([
      supabase.from('v_daily_summary').select('*').eq('baby_id', baby.id).gte('day', from),
      supabase.from('v_growth').select('started_at,weight_g,length_cm,head_cm').eq('baby_id', baby.id).order('started_at'),
      supabase.from('v_sleep').select('start_date,duration_min').eq('baby_id', baby.id).gte('start_date', from),
      supabase.from('v_pumps').select('start_date,pump_left_ml,pump_right_ml').eq('baby_id', baby.id).gte('start_date', from),
    ]);
    if (d.error) {
      // View not created yet: migration 0002 has not been run.
      if (/v_daily_summary|schema cache|does not exist/i.test(d.error.message)) setMissing(true);
      else void toast({ message: d.error.message, color: 'danger', duration: 4000 });
      return;
    }
    setMissing(false);
    setRows(trimLeading(fillDays((d.data ?? []) as DailyRow[], days)));
    setGrowth((g.data ?? []) as GrowthRow[]);
    setSleeps((sl.data ?? []) as { start_date: string; duration_min: number }[]);
    setPumps((pu.data ?? []) as typeof pumps);
  }, [baby, days, toast]);

  // Reload when the range changes or anything is logged.
  useEffect(() => { void load(); }, [load, data.events]);

  const oz = settings.volume_unit === 'oz';
  const fmtVolAxis = useCallback((v: number) => `${Math.round(v * 10) / 10}`, []);
  const fmtCount = useCallback((v: number) => String(Math.round(v * 10) / 10), []);
  const fmtHours = useCallback((m: number) => (m < 60 ? `${Math.round(m)}m` : `${Math.round((m / 60) * 10) / 10}h`), []);
  const fmtMin = useCallback((m: number) => `${Math.round(m)}m`, []);
  const toVol = useCallback((ml: number) => (oz ? Math.round(mlToOz(ml) * 10) / 10 : Math.round(ml)), [oz]);

  const view = useMemo(() => {
    if (!rows) return null;
    const today = isoDay(new Date());
    const partial = rows[rows.length - 1]?.day === today; // today's bar is unfinished
    const labels = rows.map((r) => {
      if (r.day === today) return 'Today';
      const [, m, d] = r.day.split('-').map(Number);
      return `${m}/${d}`;
    });
    const longest = longestSleepByDay(sleeps);
    const bd = baby?.birth_date;
    const guide = bd ? rows.map((r) => diaperGuide(r.day, bd)) : [];
    const diaperGuides = guide.some(Boolean) ? [
      { label: 'Wet guide', data: guide.map((x) => x?.wet ?? null), seriesIndex: 0 },
      { label: 'Dirty guide', data: guide.map((x) => x?.dirty ?? null), seriesIndex: 1 },
    ] : [];
    return {
      labels, partial, diaperGuides,
      // No sleep logged that day → a gap in the line, not a dip to zero.
      longest: [{ label: 'Longest sleep', data: rows.map((r) => longest.get(r.day) ?? null) }],
      sleep: [
        { label: 'Night', short: 'Night', data: rows.map((r) => r.night_sleep_min) },
        { label: 'Naps', short: 'Naps', data: rows.map((r) => r.nap_sleep_min) },
      ],
      feeds: [{ label: 'Feeds', data: rows.map((r) => r.feeds) }],
      feedGap: [
        // 0 = no interval that day (fewer than two feeds) → a gap, not zero hours.
        { label: 'Average', short: 'Avg', data: rows.map((r) => r.avg_feed_interval_min || null) },
        { label: 'Longest', short: 'Longest', data: rows.map((r) => r.longest_feed_interval_min || null) },
      ],
      bottle: [{ label: 'Bottle', data: rows.map((r) => toVol(r.bottle_ml)) }],
      nursing: [
        { label: 'Left', short: 'L', data: rows.map((r) => r.nursing_left_min) },
        { label: 'Right', short: 'R', data: rows.map((r) => r.nursing_right_min) },
      ],
      diapers: [
        { label: 'Wet', data: rows.map((r) => r.wet_diapers) },
        { label: 'Dirty', data: rows.map((r) => r.dirty_diapers) },
      ],
      pumpSides: (() => {
        const p = pumpBySide(pumps, rows.map((r) => r.day));
        return [
          { label: 'Total', short: 'Total', data: p.left.map((l, k) => toVol(l + p.right[k])), width: 3 },
          { label: 'Left breast', short: 'L', data: p.left.map(toVol) },
          { label: 'Right breast', short: 'R', data: p.right.map(toVol) },
        ];
      })(),
      tummy: [{ label: 'Tummy time', data: rows.map((r) => r.tummy_min) }],
      // Averages use complete days only; today's partial day would pull them down.
      avg: averages(completeDays(rows)),
      avgDays: completeDays(rows).length,
      has: (k: keyof DailyRow) => rows.some((r) => Number(r[k]) > 0),
    };
  }, [rows, toVol, sleeps, pumps, baby?.birth_date]);


  const volUnit = oz ? 'oz' : 'ml';

  return (
    <IonPage>
      <IonHeader><IonToolbar><IonTitle>Reports</IonTitle></IonToolbar></IonHeader>
      <IonContent className="ion-padding">
        <IonRefresher slot="fixed" onIonRefresh={async (e) => { await load(); e.detail.complete(); }}>
          <IonRefresherContent />
        </IonRefresher>
        {missing ? (
          <div className="empty">
            <p><b>One-time setup needed.</b></p>
            <p>Run <code>supabase/migrations/0002_reports.sql</code> in the Supabase SQL Editor, then pull down to refresh.</p>
          </div>
        ) : !view ? <div className="centered"><IonSpinner /></div> : (
          <>
            <IonSegment value={String(days)} onIonChange={(e) => setDays(Number(e.detail.value))}>
              <IonSegmentButton value="7">7 days</IonSegmentButton>
              <IonSegmentButton value="14">14 days</IonSegmentButton>
              <IonSegmentButton value="30">30 days</IonSegmentButton>
            </IonSegment>

            <h2 className="section-title">Daily average <span className="subtle">({view.avgDays === 1 && view.partial ? 'today so far' : `${view.avgDays} complete day${view.avgDays === 1 ? '' : 's'}`})</span></h2>
            <div className="summary-row summary-row-3">
              <div><b>{formatDuration(view.avg.sleepMin * 60_000)}</b><span>sleep</span></div>
              <div><b>{fmtCount(view.avg.feeds)}</b><span>feeds</span></div>
              <div><b>{formatVolume(view.avg.bottleMl, settings)}</b><span>bottle</span></div>
              <div><b>{fmtCount(view.avg.wet)}</b><span>wet diapers</span></div>
              <div><b>{fmtCount(view.avg.dirty)}</b><span>dirty diapers</span></div>
              <div><b>{formatVolume(view.avg.pumpMl, settings)}</b><span>pumped</span></div>
            </div>

            <LineChart partialLast={view.partial} integer minutesAxis stacked title="Sleep per day" labels={view.labels} series={view.sleep} format={fmtHours} hues={['blue', 'amber']}
              note="Shaded areas stack: the top edge is total sleep." />
            {view.has('sleeps') && (
              <LineChart partialLast={view.partial} integer minutesAxis title="Longest sleep stretch" labels={view.labels} series={view.longest} format={fmtHours} hues={['blue']}
                note="The longest single sleep that started that day." />
            )}
            <LineChart partialLast={view.partial} integer title="Feeds per day (nursing + bottle)" labels={view.labels} series={view.feeds} format={fmtCount} hues={['coral']}
              note="Entries less than 20 minutes apart count as one feed." />
            {view.has('longest_feed_interval_min') && (
              <LineChart partialLast={view.partial} integer minutesAxis title="Time between feeds" labels={view.labels} series={view.feedGap} format={fmtHours} hues={['teal', 'coral']}
                note={`Start of one feed to the start of the next, by the day the feed started.${view.avg.feedIntervalMin ? ` Typical: every ${formatDuration(view.avg.feedIntervalMin * 60_000)}.` : ''}`} />
            )}
            {view.has('bottle_ml') && <LineChart partialLast={view.partial} title={`Bottle (${volUnit}) per day`} labels={view.labels} series={view.bottle} format={fmtVolAxis} hues={['amber']} />}
            {(view.has('nursing_left_min') || view.has('nursing_right_min')) &&
              <LineChart partialLast={view.partial} integer stacked title="Nursing minutes per day" labels={view.labels} series={view.nursing} format={fmtMin} hues={['blue', 'coral']}
                note="Shaded areas stack: the top edge is total nursing time." />}
            <BarChart partialLast={view.partial} integer title="Diapers per day" labels={view.labels} series={view.diapers} format={fmtCount} hues={['blue', 'amber']}
              guides={view.diaperGuides}
              note={view.diaperGuides.length ? 'Guide lines: a common first-two-weeks reference, counting the birth date as day 0 (wet ≈ days old up to 6+, dirty ≈ days old up to 3+). Ask your pediatrician what to expect for your baby.' : undefined} />
            {view.has('pump_ml') && (
              <LineChart partialLast={view.partial} title={`Milk pumped per day (${volUnit})`} labels={view.labels}
                series={view.pumpSides} hues={['teal', 'blue', 'coral']} format={fmtVolAxis}
                note="Total and each breast, from the amount entered for each side of every pumping session." />
            )}
            {view.has('tummy_min') && <BarChart partialLast={view.partial} integer title="Tummy time per day" labels={view.labels} series={view.tummy} format={fmtMin} hues={['teal']} />}

            <GrowthSection rows={growth} />

            <IonList inset>
              <IonListHeader><IonLabel>Export (last {days} days)</IonLabel></IonListHeader>
              <IonItem button detail={false} onClick={() => { window.location.hash = `#/print?days=${days}`; }}>
                <IonLabel><h3>Pediatrician summary</h3><p>One printable page. Use Print → Save as PDF.</p></IonLabel>
              </IonItem>
              {EXPORTS.map((x) => (
                <IonItem key={x.key} button detail={false} onClick={async () => {
                  const err = await runExport(x.key, baby!, settings, days, data.names);
                  void toast(err ? { message: err, color: 'danger', duration: 4000 } : { message: `${x.label} CSV saved`, duration: 1500 });
                }}>
                  <IonLabel><h3>{x.label} (CSV)</h3><p>{x.description}</p></IonLabel>
                </IonItem>
              ))}
            </IonList>
            <p className="hint">Signed in as {me?.display_name}. CSV files open in Excel or Google Sheets and use your display units.</p>
            <IonButton fill="clear" expand="block" onClick={() => void load()}>Refresh</IonButton>
          </>
        )}
      </IonContent>
    </IonPage>
  );
}

function GrowthSection({ rows }: { rows: GrowthRow[] }) {
  const { baby, settings } = useHousehold();
  const toLb = useCallback((kg: number) => (settings.weight_unit === 'lb_oz' ? kg * 2.20462262 : kg), [settings.weight_unit]);
  const toLen = useCallback((cm: number) => (settings.length_unit === 'in' ? cmToIn(cm) : cm), [settings.length_unit]);
  const fmtW = useCallback((v: number) => (settings.weight_unit === 'lb_oz' ? `${Math.round(v * 10) / 10} lb` : `${Math.round(v * 10) / 10} kg`), [settings.weight_unit]);
  const fmtL = useCallback((v: number) => `${Math.round(v * 10) / 10} ${settings.length_unit}`, [settings.length_unit]);

  const series = useMemo(() => {
    if (!baby?.birth_date) return null;
    const pts = (k: 'weight_g' | 'length_cm' | 'head_cm', scale: number) => rows
      .filter((r) => r[k] != null)
      .map((r) => ({ months: ageInMonths(baby.birth_date!, new Date(r.started_at)), value: Number(r[k]) * scale }))
      .filter((p) => p.months >= 0 && p.months <= 24);
    return { weight: pts('weight_g', 0.001), length: pts('length_cm', 1), head: pts('head_cm', 1) };
  }, [rows, baby]);

  // Weight vs. first (birth) weight: needs no WHO data, so it shows even without sex/birth date.
  const wc = useMemo(() => weightChange(rows), [rows]);
  const gToUnit = useCallback((g: number) => (settings.weight_unit === 'lb_oz' ? g / 453.59237 : g / 1000), [settings.weight_unit]);
  const fmtGrams = useCallback((g: number) => formatWeight(g, settings), [settings]);
  const birth = baby?.birth_date ? (() => { const [y, m, d] = baby.birth_date!.split('-').map(Number); return new Date(y, m - 1, d).getTime(); })() : null;
  // "Birth weight" if the first weight was logged within 2 days of birth, else "First weight".
  const baseLabel = wc && birth != null && wc.base.t - birth < 2 * 86_400_000 ? 'Birth weight' : 'First weight';
  const weightCard = wc && (
    <WeightChangeChart data={wc} toDisplay={gToUnit} unit={settings.weight_unit === 'lb_oz' ? 'lb' : 'kg'}
      formatWeight={fmtGrams} dayZero={birth ?? startOfDay(new Date(wc.base.t)).getTime()} baseLabel={baseLabel} />
  );

  if (rows.length === 0) return null;
  if (!baby?.birth_date || !baby.sex || !series) {
    return (
      <>
        <h2 className="section-title">Growth</h2>
        {weightCard}
        <p className="hint">Set the baby's birth date and sex in Settings to also compare against WHO percentiles.</p>
      </>
    );
  }
  const age = ageInMonths(baby.birth_date, new Date());
  const maxMonths = Math.min(24, Math.max(3, Math.ceil(age + 1)));
  const sex = baby.sex;
  const pct = (m: Measure, months: number, v: number) => {
    const p = percentile(sex, m, months, v);
    return p == null ? '' : ` (${p < 1 ? '<1' : p > 99 ? '>99' : Math.round(p)}th pct)`;
  };
  const last = rows[rows.length - 1];
  const lastAge = ageInMonths(baby.birth_date, new Date(last.started_at));

  return (
    <>
      <h2 className="section-title">Growth</h2>
      <p className="hint">
        Latest ({new Date(last.started_at).toLocaleDateString()}):{' '}
        {[
          last.weight_g != null && `${formatWeight(Number(last.weight_g), settings)}${pct('weight', lastAge, Number(last.weight_g) / 1000)}`,
          last.length_cm != null && `${formatLength(Number(last.length_cm), settings)}${pct('length', lastAge, Number(last.length_cm))}`,
          last.head_cm != null && `head ${formatLength(Number(last.head_cm), settings)}${pct('head', lastAge, Number(last.head_cm))}`,
        ].filter(Boolean).join(' · ')}
      </p>
      {weightCard}
      {series.weight.length > 0 && <GrowthChart title="Weight" sex={sex} measure="weight" points={series.weight} toDisplay={toLb} format={fmtW} maxMonths={maxMonths} />}
      {series.length.length > 0 && <GrowthChart title="Length" sex={sex} measure="length" points={series.length} toDisplay={toLen} format={fmtL} maxMonths={maxMonths} />}
      {series.head.length > 0 && <GrowthChart title="Head circumference" sex={sex} measure="head" points={series.head} toDisplay={toLen} format={fmtL} maxMonths={maxMonths} />}
    </>
  );
}
