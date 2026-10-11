import {
  BarController, BarElement, CategoryScale, Chart, Legend, LinearScale, Tooltip, type ChartConfiguration,
} from 'chart.js';
import { useEffect, useRef } from 'react';
import { useChartTheme } from './theme';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

export interface Series { label: string; data: number[] }

/** Daily bar chart. One series → no legend (the title names it); two → legend + stacked or grouped. */
export default function BarChart({ title, labels, series, stacked = false, format, integer = false }: {
  title: string; labels: string[]; series: Series[]; stacked?: boolean; format: (v: number) => string;
  /** Whole-number axis ticks (counts and minutes). */
  integer?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const theme = useChartTheme();

  useEffect(() => {
    if (!canvas.current) return;
    const last = series.length - 1;
    const config: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: {
        labels,
        datasets: series.map((s, i) => ({
          label: s.label,
          data: s.data,
          backgroundColor: theme.series[i],
          hoverBackgroundColor: theme.series[i],
          // Rounded data-end only on the outermost stacked segment; a surface-colored
          // top edge separates stacked segments.
          borderRadius: !stacked || i === last ? { topLeft: 4, topRight: 4 } : 0,
          borderSkipped: 'start',
          borderColor: theme.surface,
          borderWidth: stacked && i < last ? { top: 2 } : 0,
          maxBarThickness: 22,
          categoryPercentage: 0.8,
          barPercentage: stacked ? 0.9 : 0.85,
        })),
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
               ticks: { color: theme.muted, maxTicksLimit: 5, font: { size: 11 }, precision: integer ? 0 : undefined, callback: (v) => format(Number(v)) } },
        },
        plugins: {
          legend: {
            display: series.length > 1, position: 'top', align: 'start',
            labels: { color: theme.text, boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 2, font: { size: 12 } },
          },
          tooltip: {
            backgroundColor: theme.dark ? '#2a2a28' : '#ffffff', titleColor: theme.text, bodyColor: theme.text,
            borderColor: theme.grid, borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true,
            callbacks: {
              label: (c) => ` ${series.length > 1 ? c.dataset.label + ': ' : ''}${format(Number(c.raw))}`,
              footer: (items) => (stacked && items.length > 1
                ? `Total: ${format(items.reduce((a, c) => a + Number(c.raw), 0))}` : ''),
            },
          },
        },
      },
    };
    const chart = new Chart(canvas.current, config);
    return () => chart.destroy();
  }, [labels, series, stacked, format, integer, theme]);

  return (
    <figure className="chart-card">
      <figcaption className="chart-title">{title}</figcaption>
      <div className="chart-box"><canvas ref={canvas} role="img" aria-label={title} /></div>
    </figure>
  );
}
