import { Chart, Legend, LinearScale, LineElement, PointElement, ScatterController, Tooltip, type ChartConfiguration, type Plugin } from 'chart.js';
import { useEffect, useRef } from 'react';
import { useChartTheme, type Hue } from './theme';

Chart.register(ScatterController, PointElement, LineElement, LinearScale, Tooltip, Legend);

export interface TimePoint { t: number; y: number; tip: string[] }

const DAY = 86_400_000;
// Colour and shape both change per bottle, so bottles stay apart even where two hues are close.
// "Not set" is always gray dots.
const HUES: Hue[] = ['blue', 'coral', 'teal', 'amber'];
const SHAPES = ['circle', 'triangle', 'rect', 'rectRot'] as const;

/**
 * One series per bottle over time: a dot per feed, joined in time order. Tap a bottle in the
 * legend to hide or show it (the selector at the top of the Bottles tab does the same for the
 * whole page). Optional shaded reference band.
 */
export default function BrandTimeChart({ title, series, format, band, note }: {
  title: string; series: { label: string; points: TimePoint[] }[];
  format: (v: number) => string; band?: { from: number; to: number; label: string }; note?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const theme = useChartTheme();

  useEffect(() => {
    if (!canvas.current) return;
    const ts = series.flatMap((s) => s.points.map((p) => p.t));
    if (!ts.length) return;
    // Whole days on the x axis, from the first feed's day to the last's.
    const day0 = new Date(Math.min(...ts)); day0.setHours(0, 0, 0, 0);
    const dayN = new Date(Math.max(...ts)); dayN.setHours(24, 0, 0, 0);
    const days = Math.max(1, Math.round((dayN.getTime() - day0.getTime()) / DAY));
    const step = days <= 8 ? 1 : days <= 16 ? 2 : 7;
    const bandPlugin: Plugin<'scatter'> = {
      id: 'brandTimeBand',
      beforeDatasetsDraw(chart) {
        if (!band) return;
        const { ctx, chartArea, scales } = chart;
        const y1 = scales.y.getPixelForValue(band.to), y2 = scales.y.getPixelForValue(band.from);
        ctx.save();
        ctx.fillStyle = theme.dark ? 'rgba(233,238,251,0.06)' : 'rgba(19,33,63,0.06)';
        ctx.fillRect(chartArea.left, y1, chartArea.right - chartArea.left, y2 - y1);
        ctx.fillStyle = theme.muted; ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'top';
        ctx.fillText(band.label, chartArea.left + 4, y1 + 2);
        ctx.restore();
      },
    };
    const config: ChartConfiguration<'scatter'> = {
      type: 'scatter',
      data: {
        datasets: series.map((s, k) => {
          const unset = s.label === 'Not set';
          const c = theme.hue[unset ? 'gray' : HUES[k % HUES.length]];
          return {
            label: s.label,
            data: [...s.points].sort((a, b) => a.t - b.t).map((p) => ({ x: p.t, y: p.y, tip: p.tip })),
            showLine: true, borderColor: c, borderWidth: 1.5, backgroundColor: c,
            pointStyle: unset ? 'circle' : SHAPES[(k + Math.floor(k / HUES.length)) % SHAPES.length], // the 5th bottle reuses blue with a new shape
            pointRadius: 5, pointHoverRadius: 7, pointBorderColor: theme.surface, pointBorderWidth: 1.5,
          };
        }),
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        scales: {
          x: {
            type: 'linear', min: day0.getTime(), max: dayN.getTime(), grid: { color: theme.grid }, border: { color: theme.grid },
            afterBuildTicks: (axis) => {
              axis.ticks = [];
              for (let d = 0; d <= days; d += step) axis.ticks.push({ value: day0.getTime() + d * DAY });
            },
            ticks: {
              color: theme.muted, font: { size: 11 }, autoSkip: false, maxRotation: 0,
              callback: (v) => { const d = new Date(Number(v)); return `${d.getMonth() + 1}/${d.getDate()}`; },
            },
          },
          y: { beginAtZero: true, suggestedMax: band ? band.to * 1.1 : undefined, border: { display: false }, grid: { color: theme.grid },
               ticks: { color: theme.muted, maxTicksLimit: 5, font: { size: 11 }, callback: (v) => format(Number(v)) } },
        },
        plugins: {
          legend: { display: true, position: 'top', align: 'start',
            labels: { color: theme.text, usePointStyle: true, boxWidth: 8, boxHeight: 8, font: { size: 12 } } },
          tooltip: {
            backgroundColor: theme.dark ? '#2a3550' : '#ffffff', titleColor: theme.text, bodyColor: theme.text,
            borderColor: theme.grid, borderWidth: 1, padding: 10, displayColors: false,
            callbacks: {
              title: (items) => (items[0]?.raw as { tip: string[] })?.tip[0] ?? '',
              label: (c) => (c.raw as { tip: string[] }).tip.slice(1),
            },
          },
        },
      },
      plugins: [bandPlugin],
    };
    const chart = new Chart(canvas.current, config);
    return () => chart.destroy();
  }, [series, format, band, theme]);

  return (
    <figure className="chart-card">
      <figcaption className="chart-title">{title}</figcaption>
      <div className="chart-box chart-box-tall"><canvas ref={canvas} role="img" aria-label={title} /></div>
      <div className="chart-note">{['Each dot is one feed, joined in time order per bottle. Tap a bottle in the legend to hide or show it.', note].filter(Boolean).join(' ')}</div>
    </figure>
  );
}
