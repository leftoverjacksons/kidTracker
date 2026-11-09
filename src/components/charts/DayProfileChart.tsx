import { Chart, Legend, LinearScale, LineElement, PointElement, ScatterController, Tooltip, type ChartConfiguration } from 'chart.js';
import { useEffect, useRef, type ReactNode } from 'react';
import type { DayProfile } from '../../lib/feeding';
import { formatTime } from '../../lib/format';
import { useChartTheme } from './theme';

Chart.register(ScatterController, PointElement, LineElement, LinearScale, Tooltip, Legend);

const alpha = (hex: string, a: number) => hex + Math.round(a * 255).toString(16).padStart(2, '0');
/** Today at full strength, then fading into the past (oldest about 20%). */
const strength = (k: number, n: number) => (k === 0 ? 1 : 0.75 - (0.55 * (k - 1)) / Math.max(1, n - 2));

/**
 * Feeds across the day (design doc §8a AA): x is the time of day from the day's start (the
 * bedtime feed on the anchored schedule), y the estimated amount. One series per day, each as
 * dots plus a smoothed line; today in teal, earlier days in blue fading into the past. Tapping a day in the legend
 * hides its dots and line.
 */
export default function DayProfileChart({ title, days, toDisplay, format, controls, note, smooth = true }: {
  title: string; days: DayProfile[]; toDisplay: (ml: number) => number; format: (v: number) => string;
  controls?: ReactNode; note?: string;
  /** true: the smoothed line; false: straight lines joining the feeds in order. */
  smooth?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const theme = useChartTheme();

  useEffect(() => {
    if (!canvas.current || !days.length) return;
    const start = days[0].start;
    const clock = (min: number) => formatTime(new Date(start.getTime() + min * 60_000)).replace(':00', '').replace(/\s?([AP])M$/i, (_, p: string) => p.toLowerCase());
    const label = (k: number) => (k === 0 ? 'Today' : k === 1 ? 'Yesterday' : `${k} days ago`);
    const config: ChartConfiguration<'scatter'> = {
      type: 'scatter',
      data: {
        // Two datasets per day, dots then line; the legend shows and toggles them as one.
        datasets: days.flatMap((d, k) => {
          // Today in teal; earlier days in blue, fading into the past, so today stands apart.
          const c = k === 0 ? theme.hue.teal : alpha(theme.hue.blue, strength(k, days.length));
          return [{
            label: label(k),
            data: d.points.map((p) => ({ x: p.x, y: toDisplay(p.y), at: p.at, ml: p.y })),
            showLine: false, backgroundColor: c, borderColor: k === 0 ? theme.surface : c,
            pointRadius: k === 0 ? 5.5 : 4, pointHoverRadius: 7, pointBorderWidth: k === 0 ? 1.5 : 0, order: k,
          }, {
            label: `${label(k)} trend`,
            data: (smooth ? d.smooth : d.points).map((p) => ({ x: p.x, y: toDisplay(p.y) })),
            showLine: true, borderColor: c, borderWidth: k === 0 ? 3 : 2, tension: smooth ? 0.3 : 0,
            pointRadius: 0, pointHoverRadius: 0, pointHitRadius: 0, order: k,
          }];
        }),
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        scales: {
          x: {
            type: 'linear', min: 0, max: 1440, grid: { color: theme.grid }, border: { color: theme.grid },
            afterBuildTicks: (axis) => { axis.ticks = [0, 180, 360, 540, 720, 900, 1080, 1260, 1440].map((value) => ({ value })); },
            ticks: { color: theme.muted, font: { size: 11 }, autoSkip: false, maxRotation: 0, callback: (v) => clock(Number(v)) },
          },
          y: { beginAtZero: true, border: { display: false }, grid: { color: theme.grid },
               ticks: { color: theme.muted, maxTicksLimit: 5, font: { size: 11 }, callback: (v) => format(Number(v)) } },
        },
        plugins: {
          legend: {
            display: days.length > 1, position: 'top', align: 'start',
            labels: { color: theme.text, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, font: { size: 12 },
              filter: (item) => (item.datasetIndex ?? 0) % 2 === 0 },
            onClick: (_e, item, legend) => {
              const i = item.datasetIndex ?? 0, ch = legend.chart, show = !ch.isDatasetVisible(i);
              ch.setDatasetVisibility(i, show); ch.setDatasetVisibility(i + 1, show); ch.update();
            },
          },
          tooltip: {
            backgroundColor: theme.dark ? '#2a3550' : '#ffffff', titleColor: theme.text, bodyColor: theme.text,
            borderColor: theme.grid, borderWidth: 1, padding: 10, displayColors: false,
            filter: (item) => item.datasetIndex % 2 === 0,
            callbacks: {
              title: (items) => {
                const r = items[0]?.raw as { at: Date } | undefined;
                return r ? `${label(Math.floor(items[0].datasetIndex / 2))} · ${formatTime(r.at)}` : '';
              },
              label: (c) => ` ${format((c.raw as { y: number }).y)}`,
            },
          },
        },
      },
    };
    const chart = new Chart(canvas.current, config);
    return () => chart.destroy();
  }, [days, toDisplay, format, theme, smooth]);

  return (
    <figure className="chart-card">
      <figcaption className="chart-title">{title}</figcaption>
      {controls}
      <div className="chart-box chart-box-tall">
        <canvas ref={canvas} role="img" aria-label={title} />
        {!days.some((d) => d.points.length) && (
          <div className="chart-empty">No feeds yet {days.length === 1 ? 'today' : `in the last ${days.length} days`}. Pick more days above.</div>
        )}
      </div>
      {note && <div className="chart-note">{note}</div>}
    </figure>
  );
}
