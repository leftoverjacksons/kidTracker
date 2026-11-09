import {
  CategoryScale, Chart, Filler, LinearScale, LineController, LineElement, PointElement, ScatterController, Tooltip,
  type ChartConfiguration,
} from 'chart.js';
import { useEffect, useRef } from 'react';
import { CURVES, DAYS_PER_MONTH, lmsAt, valueAtZ, type Measure, type Sex } from '../../lib/who';
import { useChartTheme } from './theme';

Chart.register(LineController, ScatterController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler);

const WEEK = 7 / DAYS_PER_MONTH; // one week, in months

/**
 * Baby's measurements against WHO percentile curves (3rd–97th).
 * `toDisplay` converts WHO units (kg / cm) into the household's display unit.
 * `band`: a shaded channel between two z-scores (the rapid-gain guard on weight, design doc §8a AB).
 * Up to 3 months the age axis is in weeks.
 */
export default function GrowthChart({ title, sex, measure, points, toDisplay, format, maxMonths, band, note }: {
  title: string; sex: Sex; measure: Measure;
  points: { months: number; value: number }[]; // value in WHO units
  toDisplay: (v: number) => number; format: (v: number) => string; maxMonths: number;
  band?: { lo: number; hi: number }; note?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const theme = useChartTheme();

  useEffect(() => {
    if (!canvas.current) return;
    const steps = Math.max(8, Math.ceil(maxMonths * 4));
    const curve = (z: number) => Array.from({ length: steps + 1 }, (_, i) => {
      const m = (i / steps) * maxMonths;
      const lms = lmsAt(sex, measure, m);
      return lms ? { x: m, y: toDisplay(valueAtZ(lms, z)) } : null;
    }).filter((p): p is { x: number; y: number } => p != null);

    const weeks = maxMonths <= 3;
    const age = (m: number) => (weeks ? `${Math.round((m / WEEK) * 10) / 10} weeks` : `${m.toFixed(1)} months`);
    const bandSets = band ? [
      { label: 'guard-lo', data: curve(band.lo), parsing: false as const, borderColor: theme.hue.teal, borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, tension: 0.3, fill: false },
      { label: 'guard-hi', data: curve(band.hi), parsing: false as const, borderColor: theme.hue.teal, borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, tension: 0.3,
        fill: '-1' as const, backgroundColor: theme.hue.teal + '24' },
    ] : [];
    const config: ChartConfiguration<'line'> = {
      type: 'line',
      data: {
        datasets: [
          ...bandSets,
          ...CURVES.map((c) => ({
            label: `${c.label} percentile`, data: curve(c.z), parsing: false as const,
            borderColor: theme.reference, borderWidth: c.z === 0 ? 1.5 : 1, pointRadius: 0, tension: 0.3,
          })),
          {
            label: title, data: points.map((p) => ({ x: p.months, y: toDisplay(p.value) })), parsing: false as const,
            borderColor: theme.series[0], backgroundColor: theme.series[0], borderWidth: 2,
            pointRadius: 4, pointHoverRadius: 6, pointBorderColor: theme.surface, pointBorderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, ...(theme.dpr ? { devicePixelRatio: theme.dpr } : {}), animation: false,
        interaction: { mode: 'nearest', intersect: false },
        scales: {
          x: { type: 'linear', min: 0, max: maxMonths, grid: { color: theme.grid }, border: { color: theme.grid },
               title: { display: true, text: weeks ? 'Age (weeks)' : 'Age (months)', color: theme.muted, font: { size: 11 } },
               ...(weeks ? { afterBuildTicks: (axis: { ticks: { value: number }[] }) => {
                 const every = maxMonths / WEEK > 8 ? 2 : 1;
                 axis.ticks = Array.from({ length: Math.floor(maxMonths / WEEK / every) + 1 }, (_, k) => ({ value: k * every * WEEK }));
               } } : {}),
               ticks: { color: theme.muted, font: { size: 11 }, autoSkip: !weeks,
                 ...(weeks ? { callback: (v: string | number) => String(Math.round(Number(v) / WEEK)) } : { stepSize: maxMonths <= 6 ? 1 : 3 }) } },
          y: { grid: { color: theme.grid }, border: { display: false },
               ticks: { color: theme.muted, font: { size: 11 }, maxTicksLimit: 6, callback: (v) => format(Number(v)) } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: (item) => item.datasetIndex === bandSets.length + CURVES.length,
            backgroundColor: theme.dark ? '#2a3550' : '#ffffff', titleColor: theme.text, bodyColor: theme.text,
            borderColor: theme.grid, borderWidth: 1, padding: 10,
            callbacks: {
              title: (items) => (items[0] ? age(Number(items[0].parsed.x)) : ''),
              label: (c) => ` ${format(Number(c.parsed.y))}`,
            },
          },
        },
      },
    };
    const chart = new Chart(canvas.current, config);
    return () => chart.destroy();
  }, [title, sex, measure, points, toDisplay, format, maxMonths, theme, band?.lo, band?.hi]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <figure className="chart-card">
      <figcaption className="chart-title">{title}</figcaption>
      <div className="chart-box chart-box-tall"><canvas ref={canvas} role="img" aria-label={`${title} with WHO percentiles`} /></div>
      <div className="chart-note">{['Gray lines: WHO 3rd, 15th, 50th, 85th, 97th percentiles.', note].filter(Boolean).join(' ')}</div>
    </figure>
  );
}
