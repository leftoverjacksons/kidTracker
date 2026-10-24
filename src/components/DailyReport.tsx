import { useMemo } from 'react';
import LineChart from './charts/LineChart';
import { cumulativeIntake, cumulativePumped, hourMarks, last24 } from '../lib/daily';
import { useData, useNow } from '../lib/data';
import { dailyTargetAt, readPlan } from '../lib/feeding';
import { formatDuration, formatVolume } from '../lib/format';
import { useHousehold } from '../lib/household';
import { mlToOz } from '../lib/units';

/** Daily averages over complete days (from the Overview data), shown under each last-24-h number. */
export interface Averages { sleepMin: number; feeds: number; bottleMl: number; wet: number; dirty: number; pumpMl: number }

const fmtCount = (v: number) => String(Math.round(v * 10) / 10);
const hourLabel = (d: Date, k: number, last: number) =>
  k === last ? 'Now' : d.toLocaleTimeString([], { hour: 'numeric' }).replace(/\s?([AP])M$/i, (_, x: string) => x.toLowerCase());

/** Reports → Daily: the rolling last 24 hours (design doc §8a R). */
export default function DailyReport({ avg, avgDays }: { avg: Averages | null; avgDays: number }) {
  const { baby, settings } = useHousehold();
  const data = useData();
  const now = useNow(60_000);
  const plan = readPlan(settings.feeding_plan);
  const oz = settings.volume_unit === 'oz';
  const unit = oz ? 'oz' : 'ml';
  const toVol = (ml: number) => (oz ? Math.round(mlToOz(ml) * 10) / 10 : Math.round(ml));
  const fmtVol = useMemo(() => (v: number) => `${Math.round(v * 10) / 10}`, []);

  const v = useMemo(() => {
    const marks = hourMarks(now);
    const labels = marks.map((m, k) => hourLabel(m, k, marks.length - 1));
    const t = last24(data.events, plan, now);
    const c = cumulativeIntake(data.events, plan, marks);
    const p = cumulativePumped(data.events, marks);
    const daily = dailyTargetAt(plan, baby?.birth_date ?? null, now);
    const intake = [
      { label: 'Breast milk (bottle)', short: 'BM', data: c.bm.map(toVol), hue: 'blue' as const },
      { label: 'Formula', short: 'F', data: c.formula.map(toVol), hue: 'coral' as const },
      ...(c.other.at(-1)! > 0 ? [{ label: 'Mixed / not labelled', short: 'Mix', data: c.other.map(toVol), hue: 'gray' as const }] : []),
      ...(c.nursing.at(-1)! > 0 ? [{ label: 'Nursing (estimated)', short: 'N', data: c.nursing.map(toVol), hue: 'teal' as const }] : []),
    ];
    // On pace: the daily target spread evenly over the 24 hours.
    const pace = daily && { from: marks.map((_, k) => toVol((daily.min * k) / 24)), to: marks.map((_, k) => toVol((daily.max * k) / 24)), label: `On pace for the daily target (${toVol(daily.min)}–${toVol(daily.max)} ${unit})` };
    return {
      labels, t, intake, pace, daily,
      pump: [
        { label: 'Total', short: 'Total', data: p.left.map((l, k) => toVol(l + p.right[k])), width: 3 },
        { label: 'Left breast', short: 'L', data: p.left.map(toVol) },
        { label: 'Right breast', short: 'R', data: p.right.map(toVol) },
      ],
    };
  }, [data.events, now, plan.nursing_ml_per_min, plan.target, baby?.birth_date, oz]); // eslint-disable-line react-hooks/exhaustive-deps

  const a = (s: string) => (avg ? <small>avg {s}</small> : null);
  return (
    <>
      <h2 className="section-title">Last 24 hours <span className="subtle">(averages: {avgDays} complete day{avgDays === 1 ? '' : 's'})</span></h2>
      <div className="summary-row summary-row-3 summary-row-avg">
        <div><b>{formatDuration(v.t.sleepMin * 60_000)}</b><span>sleep</span>{a(formatDuration((avg?.sleepMin ?? 0) * 60_000))}</div>
        <div><b>{v.t.feeds}</b><span>feeds</span>{a(fmtCount(avg?.feeds ?? 0))}</div>
        <div><b>{formatVolume(v.t.bottleMl, settings)}</b><span>bottle</span>{a(formatVolume(avg?.bottleMl ?? 0, settings))}</div>
        <div><b>{v.t.wet}</b><span>wet diapers</span>{a(fmtCount(avg?.wet ?? 0))}</div>
        <div><b>{v.t.dirty}</b><span>dirty diapers</span>{a(fmtCount(avg?.dirty ?? 0))}</div>
        <div><b>{formatVolume(v.t.pumpMl, settings)}</b><span>pumped</span>{a(formatVolume(avg?.pumpMl ?? 0, settings))}</div>
      </div>

      <LineChart stacked title={`Intake, last 24 hours (${unit}, estimated): ${v.t.nursingMin > 0 ? '~' : ''}${formatVolume(v.t.intakeMl, settings)}`}
        labels={v.labels} series={v.intake} hues={v.intake.map((x) => x.hue)} format={fmtVol} band={v.pace ?? undefined}
        note={`Running total by the hour; shaded areas stack. Nursing counts as ${plan.nursing_ml_per_min} ml per minute.${v.pace ? ' The band is the daily target spread evenly over the day.' : ''}`} />
      <LineChart title={`Milk pumped, last 24 hours (${unit}): ${formatVolume(v.t.pumpMl, settings)}`} labels={v.labels} series={v.pump}
        hues={['teal', 'blue', 'coral']} format={fmtVol} note="Running total by the hour, each breast and both together." />
    </>
  );
}
