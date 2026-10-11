import {
  CategoryScale, Chart, LinearScale, LineController, LineElement, PointElement, ScatterController, Tooltip,
  type ChartConfiguration,
} from 'chart.js';
import { useEffect, useRef } from 'react';
import { CURVES, lmsAt, valueAtZ, type Measure, type Sex } from '../../lib/who';
import { useChartTheme } from './theme';

Chart.register(LineController, ScatterController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip);

/**
 * Baby's measurements against WHO percentile curves (3rd–97th).
 * `toDisplay` converts WHO units (kg / cm) into the household's display unit.
 */
export default function GrowthChart({ title, sex, measure, points, toDisplay, format, maxMonths }: {
  title: string; sex: Sex; measure: Measure;
  points: { months: number; value: number }[]; // value in WHO units
  toDisplay: (v: number) => number; format: (v: number) => string; maxMonths: number;
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

    const config: ChartConfiguration<'line'> = {
      type: 'line',
      data: {
        datasets: [
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
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'nearest', intersect: false },
        scales: {
          x: { type: 'linear', min: 0, max: maxMonths, grid: { color: theme.grid }, border: { color: theme.grid },
               title: { display: true, text: 'Age (months)', color: theme.muted, font: { size: 11 } },
               ticks: { color: theme.muted, font: { size: 11 }, stepSize: maxMonths <= 6 ? 1 : 3 } },
          y: { grid: { color: theme.grid }, border: { display: false },
               ticks: { color: theme.muted, font: { size: 11 }, maxTicksLimit: 6, callback: (v) => format(Number(v)) } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: (item) => item.datasetIndex === CURVES.length,
            backgroundColor: theme.dark ? '#2a2a28' : '#ffffff', titleColor: theme.text, bodyColor: theme.text,
            borderColor: theme.grid, borderWidth: 1, padding: 10,
            callbacks: {
              title: (items) => (items[0] ? `${Number(items[0].parsed.x).toFixed(1)} months` : ''),
              label: (c) => ` ${format(Number(c.parsed.y))}`,
            },
          },
        },
      },
    };
    const chart = new Chart(canvas.current, config);
    return () => chart.destroy();
  }, [title, sex, measure, points, toDisplay, format, maxMonths, theme]);

  return (
    <figure className="chart-card">
      <figcaption className="chart-title">{title}</figcaption>
      <div className="chart-box chart-box-tall"><canvas ref={canvas} role="img" aria-label={`${title} with WHO percentiles`} /></div>
      <div className="chart-note">Gray lines: WHO 3rd, 15th, 50th, 85th, 97th percentiles.</div>
    </figure>
  );
}
