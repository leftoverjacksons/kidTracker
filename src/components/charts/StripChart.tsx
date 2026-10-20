import { Chart, Legend, LinearScale, PointElement, ScatterController, Tooltip, type ChartConfiguration, type Plugin } from 'chart.js';
import { useEffect, useRef } from 'react';
import { useChartTheme, type Hue } from './theme';

Chart.register(ScatterController, PointElement, LinearScale, Tooltip, Legend);

export interface StripPoint { cat: number; y: number; group: number; tip: string[] }

/**
 * One column of dots per category (e.g. bottle brand), one dot per item, with a short
 * line at each column's median. Dots are coloured by `groups` (validated hues) and spread
 * sideways a little so they don't hide each other. Optional shaded reference band.
 */
export default function StripChart({ title, categories, points, groups, format, medians, band, note }: {
  title: string; categories: string[]; points: StripPoint[]; groups: { label: string; hue: Hue }[];
  format: (v: number) => string; medians: (number | null)[];
  band?: { from: number; to: number; label: string }; note?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const theme = useChartTheme();

  useEffect(() => {
    if (!canvas.current) return;
    const n = categories.length;
    // Deterministic spread within a column: −0.25…+0.25.
    const jitter = (i: number) => (((i * 7919) % 101) / 100 - 0.5) * 0.5;
    const extras: Plugin<'scatter'> = {
      id: 'stripExtras',
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
      afterDatasetsDraw(chart) {
        const { ctx, scales } = chart;
        ctx.save(); ctx.strokeStyle = theme.text; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
        medians.forEach((m, k) => {
          if (m == null) return;
          const x = scales.x.getPixelForValue(k), w = (scales.x.getPixelForValue(1) - scales.x.getPixelForValue(0)) * 0.36;
          const y = scales.y.getPixelForValue(m);
          ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(x + w, y); ctx.stroke();
        });
        ctx.restore();
      },
    };
    const config: ChartConfiguration<'scatter'> = {
      type: 'scatter',
      data: {
        datasets: groups.map((g, gi) => ({
          label: g.label,
          data: points.map((p, i) => ({ p, i })).filter(({ p }) => p.group === gi).map(({ p, i }) => ({ x: p.cat + jitter(i), y: p.y, tip: p.tip })),
          backgroundColor: theme.hue[g.hue], borderColor: theme.surface, borderWidth: 1.5, pointRadius: 5.5, pointHoverRadius: 7,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        scales: {
          x: { type: 'linear', min: -0.5, max: n - 0.5, grid: { display: false }, border: { color: theme.grid },
               afterBuildTicks: (axis) => { axis.ticks = categories.map((_, k) => ({ value: k })); },
               ticks: { color: theme.text, font: { size: 11 }, autoSkip: false, maxRotation: 0, callback: (v) => categories[Number(v)] ?? '' } },
          y: { beginAtZero: true, border: { display: false }, grid: { color: theme.grid },
               ticks: { color: theme.muted, maxTicksLimit: 5, font: { size: 11 }, callback: (v) => format(Number(v)) } },
        },
        plugins: {
          legend: { display: groups.length > 1, position: 'top', align: 'start',
            labels: { color: theme.text, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, font: { size: 12 } } },
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
      plugins: [extras],
    };
    const chart = new Chart(canvas.current, config);
    return () => chart.destroy();
  }, [categories, points, groups, format, medians, band, theme]);

  return (
    <figure className="chart-card">
      <figcaption className="chart-title">{title}</figcaption>
      <div className="chart-box chart-box-tall"><canvas ref={canvas} role="img" aria-label={title} /></div>
      <div className="chart-note">{['Each dot is one feed; the bar is the middle (median) feed for that bottle.', note].filter(Boolean).join(' ')}</div>
    </figure>
  );
}
