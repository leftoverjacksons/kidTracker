import {
  IonButton, IonContent, IonHeader, IonItem, IonLabel, IonList, IonListHeader, IonPage, IonRefresher,
  IonRefresherContent, IonSegment, IonSegmentButton, IonSpinner, IonTitle, IonToolbar, useIonToast,
} from '@ionic/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import BarChart from '../components/charts/BarChart';
import GrowthChart from '../components/charts/GrowthChart';
import { useData } from '../lib/data';
import { formatDuration, formatLength, formatVolume, formatWeight, startOfDay } from '../lib/format';
import { useHousehold } from '../lib/household';
import { averages, fillDays, isoDay, trimLeading, type DailyRow } from '../lib/reports';
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
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    if (!supabase || !baby) return;
    const from = isoDay(new Date(startOfDay(new Date()).getTime() - (days - 1) * 86_400_000));
    const [d, g] = await Promise.all([
      supabase.from('v_daily_summary').select('*').eq('baby_id', baby.id).gte('day', from),
      supabase.from('v_growth').select('started_at,weight_g,length_cm,head_cm').eq('baby_id', baby.id).order('started_at'),
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
    const labels = rows.map((r) => { const [, m, d] = r.day.split('-').map(Number); return `${m}/${d}`; });
    return {
      labels,
      sleep: [
        { label: 'Night', data: rows.map((r) => r.night_sleep_min) },
        { label: 'Naps', data: rows.map((r) => r.nap_sleep_min) },
      ],
      feeds: [{ label: 'Feeds', data: rows.map((r) => r.feeds) }],
      bottle: [{ label: 'Bottle', data: rows.map((r) => toVol(r.bottle_ml)) }],
      nursing: [
        { label: 'Left', data: rows.map((r) => r.nursing_left_min) },
        { label: 'Right', data: rows.map((r) => r.nursing_right_min) },
      ],
      diapers: [
        { label: 'Wet', data: rows.map((r) => r.wet_diapers) },
        { label: 'Dirty', data: rows.map((r) => r.dirty_diapers) },
      ],
      pump: [{ label: 'Pumped', data: rows.map((r) => toVol(r.pump_ml)) }],
      tummy: [{ label: 'Tummy time', data: rows.map((r) => r.tummy_min) }],
      avg: averages(rows),
      has: (k: keyof DailyRow) => rows.some((r) => Number(r[k]) > 0),
    };
  }, [rows, toVol]);


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

            <h2 className="section-title">Daily average</h2>
            <div className="summary-row summary-row-3">
              <div><b>{formatDuration(view.avg.sleepMin * 60_000)}</b><span>sleep</span></div>
              <div><b>{fmtCount(view.avg.feeds)}</b><span>feeds</span></div>
              <div><b>{formatVolume(view.avg.bottleMl, settings)}</b><span>bottle</span></div>
              <div><b>{fmtCount(view.avg.wet)}</b><span>wet diapers</span></div>
              <div><b>{fmtCount(view.avg.dirty)}</b><span>dirty diapers</span></div>
              <div><b>{formatVolume(view.avg.pumpMl, settings)}</b><span>pumped</span></div>
            </div>

            <BarChart integer title="Sleep per day" labels={view.labels} series={view.sleep} stacked format={fmtHours} />
            <BarChart integer title="Feeds per day (nursing + bottle)" labels={view.labels} series={view.feeds} format={fmtCount} />
            {view.has('bottle_ml') && <BarChart title={`Bottle (${volUnit}) per day`} labels={view.labels} series={view.bottle} format={fmtVolAxis} />}
            {(view.has('nursing_left_min') || view.has('nursing_right_min')) &&
              <BarChart integer title="Nursing minutes per day" labels={view.labels} series={view.nursing} stacked format={fmtMin} />}
            <BarChart integer title="Diapers per day" labels={view.labels} series={view.diapers} format={fmtCount} />
            {view.has('pump_ml') && <BarChart title={`Pumped (${volUnit}) per day`} labels={view.labels} series={view.pump} format={fmtVolAxis} />}
            {view.has('tummy_min') && <BarChart integer title="Tummy time per day" labels={view.labels} series={view.tummy} format={fmtMin} />}

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

  if (rows.length === 0) return null;
  if (!baby?.birth_date || !baby.sex || !series) {
    return <p className="hint">Growth charts: set the baby's birth date and sex in Settings to compare against WHO percentiles.</p>;
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
      {series.weight.length > 0 && <GrowthChart title="Weight" sex={sex} measure="weight" points={series.weight} toDisplay={toLb} format={fmtW} maxMonths={maxMonths} />}
      {series.length.length > 0 && <GrowthChart title="Length" sex={sex} measure="length" points={series.length} toDisplay={toLen} format={fmtL} maxMonths={maxMonths} />}
      {series.head.length > 0 && <GrowthChart title="Head circumference" sex={sex} measure="head" points={series.head} toDisplay={toLen} format={fmtL} maxMonths={maxMonths} />}
    </>
  );
}
