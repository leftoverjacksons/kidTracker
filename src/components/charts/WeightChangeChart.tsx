import {
  BarController, BarElement, Chart, LinearScale, LineController, LineElement, PointElement, Tooltip,
  type ChartConfiguration, type Plugin,
} from 'chart.js';
import { useEffect, useRef } from 'react';
import type { WeightChange } from '../../lib/weight';
import { formatPct } from '../../lib/weight';
import { useChartTheme } from './theme';

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, LinearScale, Tooltip);

const DAY = 86_400_000;
const alpha = (hex: string, a: number) => hex + Math.round(a * 255).toString(16).padStart(2, '0');

/**
 * Weight over time with, behind it, a bar from the first weight to each weight:
 * blue = above the first weight, red = below. One weight scale (left); the right
 * edge labels the same scale as % of the first weight, so the two cannot disagree.
 */
export default function WeightChangeChart({ data, toDisplay, unit, formatWeight, dayZero, baseLabel }: {
  data: WeightChange;
  /** grams → display unit (lb or kg) */
  toDisplay: (g: number) => number;
  unit: string;
  formatWeight: (g: number) => string;
  /** x = days since this time (birth if known, else the first weight) */
  dayZero: number;
  baseLabel: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const theme = useChartTheme();

  useEffect(() => {
    if (!canvas.current) return;
    const base = toDisplay(data.base.grams);
    const day = (t: number) => (t - dayZero) / DAY;
    const pts = data.points.map((p) => ({ x: day(p.t), y: toDisplay(p.grams), p }));
    const showRef = data.lowest.pct < -5; // −10% checkpoint line only once a real loss shows up
    const ys = pts.map((q) => q.y).concat(base, showRef ? base * 0.9 : base);
    const pad = base * 0.015;
    const yMin = Math.min(...ys) - pad, yMax = Math.max(...ys) + pad;
    // Whole-day axis with a tidy step (1, 2, 7 or 14 days) and room after the last point.
    const span = Math.max(day(data.latest.t) + 0.5, 7);
    const xStep = span <= 8 ? 1 : span <= 16 ? 2 : span <= 56 ? 7 : 14;
    const xMax = Math.ceil(span / xStep) * xStep;
    const toPct = (v: number) => ((v - base) / base) * 100;

    // Reference lines and selective direct labels (latest + lowest), drawn on the canvas.
    const annotate: Plugin<'bar' | 'line'> = {
      id: 'weightAnnotate',
      // Midnight boundaries between days, behind the bars (labels sit mid-day, see x ticks).
      beforeDatasetsDraw(chart) {
        const { ctx, chartArea: a, scales } = chart;
        ctx.save();
        ctx.strokeStyle = theme.grid; ctx.lineWidth = 1;
        for (let d = xStep; d < xMax; d += xStep) {
          const px = Math.round(scales.x.getPixelForValue(d)) + 0.5;
          ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
        }
        ctx.restore();
      },
      afterDatasetsDraw(chart) {
        const { ctx, chartArea: a, scales } = chart;
        const y = scales.y, x = scales.x;
        ctx.save();
        const hline = (v: number, color: string, text: string) => {
          const py = y.getPixelForValue(v);
          ctx.strokeStyle = color; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(a.left, py); ctx.lineTo(a.right, py); ctx.stroke();
          ctx.fillStyle = theme.muted; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left';
          ctx.fillText(text, a.left + 4, py - 4);
        };
        hline(base, theme.reference, baseLabel);
        if (showRef) hline(base * 0.9, theme.grid, '−10%');
        const label = (q: (typeof pts)[number], below: boolean) => {
          const px = x.getPixelForValue(q.x), py = y.getPixelForValue(q.y);
          ctx.fillStyle = theme.text; ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = px > a.right - 40 ? 'right' : 'center';
          ctx.fillText(formatPct(q.p.pct), px, below ? py + 18 : py - 10);
        };
        const last = pts[pts.length - 1];
        const low = pts.find((q) => q.p === data.lowest)!;
        if (pts.length > 1) label(last, last.p.pct < 0 && last.y <= low.y + 0.0001);
        if (low !== last && low.p.pct < 0) label(low, true);
        ctx.restore();
      },
    };

    const config: ChartConfiguration<'bar' | 'line'> = {
      type: 'bar',
      data: {
        datasets: [
          {
            type: 'line', label: 'Weight', data: pts.map((q) => ({ x: q.x, y: q.y })), parsing: false,
            borderColor: theme.text, backgroundColor: theme.text, borderWidth: 2, tension: 0.25,
            pointRadius: 4, pointHoverRadius: 6, pointBorderColor: theme.surface, pointBorderWidth: 2, order: 0,
          },
          {
            type: 'bar', label: 'Change', order: 1,
            // Floating bars [first weight, this weight]; Chart.js parses {x, y: [from, to]} itself.
            data: pts.map((q) => ({ x: q.x, y: [base, q.y] as unknown as number })),
            backgroundColor: pts.map((q) => alpha(q.p.pct >= 0 ? theme.gain : theme.loss, 0.5)),
            hoverBackgroundColor: pts.map((q) => alpha(q.p.pct >= 0 ? theme.gain : theme.loss, 0.75)),
            borderSkipped: false, borderRadius: 2, barThickness: 10,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, ...(theme.dpr ? { devicePixelRatio: theme.dpr } : {}), animation: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        scales: {
          x: {
            type: 'linear', min: 0, max: xMax, grid: { display: false }, border: { color: theme.grid },
            // Points sit at their exact time; each day's label is centred in that day (midnight to midnight).
            afterBuildTicks: (axis) => {
              axis.ticks = [];
              for (let d = 0; d < xMax; d += xStep) axis.ticks.push({ value: d + 0.5 });
            },
            ticks: {
              color: theme.muted, font: { size: 11 }, autoSkip: false, maxRotation: 0,
              callback: (v) => {
                const d = Math.floor(Number(v));
                const date = new Date(dayZero + d * DAY + DAY / 2);
                return [`${date.getMonth() + 1}/${date.getDate()}`, `day ${d}`];
              },
            },

          },
          y: {
            min: yMin, max: yMax, border: { display: false }, grid: { color: theme.grid },
            ticks: { color: theme.muted, font: { size: 11 }, maxTicksLimit: 6, callback: (v) => `${Math.round(Number(v) * 10) / 10} ${unit}` },
          },
          // Same scale, labelled as % of the first weight.
          pct: {
            position: 'right', min: yMin, max: yMax, grid: { display: false }, border: { display: false },
            // Round percentages (every 2.5% or 5%), placed at the matching weights.
            afterBuildTicks: (axis) => { axis.ticks = pctTicks(base, yMin, yMax); },
            ticks: { color: theme.muted, font: { size: 11 }, callback: (v) => formatPct(toPct(Number(v))) },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: (item) => item.datasetIndex === 0,
            backgroundColor: theme.dark ? '#2a3550' : '#ffffff', titleColor: theme.text, bodyColor: theme.text,
            borderColor: theme.grid, borderWidth: 1, padding: 10,
            callbacks: {
              title: (items) => {
                const q = pts[items[0].dataIndex];
                return `${new Date(q.p.t).toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${Math.floor(q.x)} days old`;
              },
              label: (c) => {
                const q = pts[c.dataIndex];
                return ` ${formatWeight(q.p.grams)} (${formatPct(q.p.pct)})`;
              },
            },
          },
        },
      },
      plugins: [annotate],
    };
    const chart = new Chart(canvas.current, config);
    return () => chart.destroy();
  }, [data, toDisplay, unit, formatWeight, dayZero, baseLabel, theme]);

  const r = data.regainedAt;
  return (
    <figure className="chart-card">
      <figcaption className="chart-title">Weight vs. {baseLabel.toLowerCase()}</figcaption>
      <div className="chart-legend-inline">
        <span><i style={{ background: theme.text }} />Weight</span>
        <span><i style={{ background: alpha(theme.gain, 0.5) }} />Above</span>
        <span><i style={{ background: alpha(theme.loss, 0.5) }} />Below</span>
      </div>
      <div className="chart-box chart-box-tall"><canvas ref={canvas} role="img" aria-label="Weight over time and percent change from the first weight" /></div>
      <div className="chart-note">
        {data.points.length < 2
          ? 'Log another weight to see the change.'
          : `Now ${formatWeight(data.latest.grams)} (${formatPct(data.latest.pct)})` +
            (data.lowest.pct < 0 ? ` · lowest ${formatPct(data.lowest.pct)}` : '') +
            (r ? ` · back above ${baseLabel.toLowerCase()} at ${Math.floor((r - dayZero) / DAY)} days old` : '')}
      </div>
    </figure>
  );
}

/** Weight values at round percentages of `base` that fall inside [lo, hi]. */
export function pctTicks(base: number, lo: number, hi: number): { value: number }[] {
  const pLo = ((lo - base) / base) * 100, pHi = ((hi - base) / base) * 100;
  const step = pHi - pLo > 12 ? 5 : 2.5;
  const out: { value: number }[] = [];
  for (let p = Math.ceil(pLo / step) * step; p <= pHi + 1e-9; p += step) out.push({ value: base * (1 + p / 100) });
  return out;
}
