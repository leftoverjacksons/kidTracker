import {
  BarController, BarElement, CategoryScale, Chart, Legend, LinearScale, LineController, LineElement, PointElement, Tooltip,
  type ChartConfiguration, type ChartDataset,
} from 'chart.js';
import { useEffect, useRef } from 'react';
import { useChartTheme } from './theme';

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend);

export interface Series { label: string; data: number[] }
/** A reference drawn as a thin stepped line in the colour of series `seriesIndex`; null = no guide that day. */
export interface Guide { label: string; data: (number | null)[]; seriesIndex: number }

const fade = (hex: string) => hex + '66'; // 40% alpha for the unfinished day

/** Daily bar chart. One series → no legend (the title names it); two → legend + stacked or grouped. */
/** Tick step (minutes) at whole/half hours for a minutes axis whose largest value is `max`. */
export function hourStep(max: number): number {
  return [30, 60, 120, 180, 240, 360, 480].find((s) => s * 5 >= max) ?? 720;
}

export default function BarChart({ title, labels, series, stacked = false, format, integer = false, partialLast = false, guides = [], note, minutesAxis = false }: {
  title: string; labels: string[]; series: Series[]; stacked?: boolean; format: (v: number) => string;
  /** Whole-number axis ticks (counts and minutes). */
  integer?: boolean;
  /** The last bar is today's unfinished day: drawn lighter and marked "so far". */
  partialLast?: boolean;
  guides?: Guide[];
  note?: string;
  /** Values are minutes: put ticks on whole/half hours. */
  minutesAxis?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const theme = useChartTheme();

  useEffect(() => {
    if (!canvas.current) return;
    const last = series.length - 1;
    const lastBar = labels.length - 1;
    const colors = (c: string) => labels.map((_, k) => (partialLast && k === lastBar ? fade(c) : c));
    const guideSets: ChartDataset<'line', (number | null)[]>[] = guides.map((g) => ({
      type: 'line', label: g.label, data: g.data, stack: `guide-${g.label}`,
      borderColor: theme.series[g.seriesIndex], backgroundColor: theme.series[g.seriesIndex],
      borderWidth: 1.5, stepped: 'middle', pointRadius: 0, pointHoverRadius: 0, spanGaps: false, order: -1,
      pointStyle: 'line',
    }));
    const totals = labels.map((_, k) => (stacked ? series.reduce((a, s2) => a + (s2.data[k] ?? 0), 0) : Math.max(...series.map((s2) => s2.data[k] ?? 0))));
    const stepSize = minutesAxis ? hourStep(Math.max(1, ...totals)) : undefined;
    const config: ChartConfiguration<'bar' | 'line'> = {
      type: 'bar',
      data: {
        labels,
        datasets: [...series.map((s, i) => ({
          type: 'bar' as const,
          pointStyle: 'rectRounded' as const,
          label: s.label,
          data: s.data,
          backgroundColor: colors(theme.series[i]),
          hoverBackgroundColor: colors(theme.series[i]),
          // Rounded data-end only on the outermost stacked segment; a surface-colored
          // top edge separates stacked segments.
          borderRadius: !stacked || i === last ? { topLeft: 4, topRight: 4 } : 0,
          borderSkipped: 'start' as const,
          borderColor: theme.surface,
          borderWidth: stacked && i < last ? { top: 2 } : 0,
          maxBarThickness: 22,
          categoryPercentage: 0.8,
          barPercentage: stacked ? 0.9 : 0.85,
        })), ...guideSets],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { stacked, grid: { display: false }, border: { color: theme.grid },
               ticks: { color: theme.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 7, font: { size: 11 } } },
          y: { stacked, beginAtZero: true, border: { display: false }, grid: { color: theme.grid, lineWidth: 1 },
               ticks: { color: theme.muted, maxTicksLimit: 5, font: { size: 11 }, precision: integer ? 0 : undefined, stepSize, callback: (v) => format(Number(v)) } },
        },
        plugins: {
          legend: {
            display: series.length + guides.length > 1, position: 'top', align: 'start',
            labels: {
              color: theme.text, boxWidth: 10, boxHeight: 10, font: { size: 12 },
              // Bars show as squares, guide lines as short lines; listed in dataset order.
              usePointStyle: guides.length > 0, pointStyleWidth: 14,
              sort: (a, b) => (a.datasetIndex ?? 0) - (b.datasetIndex ?? 0),
              ...(guides.length ? {} : { useBorderRadius: true, borderRadius: 2 }),
            },
          },
          tooltip: {
            backgroundColor: theme.dark ? '#2a2a28' : '#ffffff', titleColor: theme.text, bodyColor: theme.text,
            borderColor: theme.grid, borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true,
            callbacks: {
              title: (items) => (items[0] ? `${items[0].label}${partialLast && items[0].dataIndex === lastBar ? ' (so far)' : ''}` : ''),
              label: (c) => (c.raw == null ? '' : ` ${series.length + guides.length > 1 ? c.dataset.label + ': ' : ''}${format(Number(c.raw))}`),
              footer: (items) => {
                const bars = items.filter((c) => c.datasetIndex < series.length);
                return stacked && bars.length > 1 ? `Total: ${format(bars.reduce((a, c) => a + Number(c.raw), 0))}` : '';
              },
            },
          },
        },
      },
    };
    const chart = new Chart(canvas.current, config);
    return () => chart.destroy();
  }, [labels, series, stacked, format, integer, partialLast, guides, minutesAxis, theme]);

  return (
    <figure className="chart-card">
      <figcaption className="chart-title">{title}</figcaption>
      <div className="chart-box"><canvas ref={canvas} role="img" aria-label={title} /></div>
      {(note || partialLast) && <div className="chart-note">{[partialLast && 'Lighter bar: today so far.', note].filter(Boolean).join(' ')}</div>}
    </figure>
  );
}
