import { CategoryScale, Chart, Legend, LinearScale, LineController, LineElement, PointElement, Tooltip, type ChartConfiguration, type Plugin } from 'chart.js';
import { useEffect, useRef } from 'react';
import { useChartTheme, type Hue } from './theme';

Chart.register(LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend);

export interface LineSeries { label: string; short?: string; data: number[] }

/**
 * Daily line chart (one value per day per series). Legend plus a short direct label at
 * each line's end; crosshair + tooltip on touch. When `partialLast`, the segment into
 * today is dashed and today's point hollow, since the day isn't over.
 */
export default function LineChart({ title, labels, series, hues, format, partialLast = false, note }: {
  title: string; labels: string[]; series: LineSeries[]; hues: Hue[]; format: (v: number) => string;
  partialLast?: boolean; note?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const theme = useChartTheme();

  useEffect(() => {
    if (!canvas.current) return;
    const last = labels.length - 1;
    const colors = hues.map((h) => theme.hue[h]);
    // Direct labels ("L", "R") just right of each line's last point.
    const endLabels: Plugin<'line'> = {
      id: 'endLabels',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        ctx.save();
        ctx.font = '600 11px system-ui, sans-serif'; ctx.fillStyle = theme.text; ctx.textBaseline = 'middle';
        chart.data.datasets.forEach((_, i) => {
          const pts = chart.getDatasetMeta(i).data;
          const p = pts[pts.length - 1];
          if (p && series[i].short) ctx.fillText(series[i].short!, p.x + 8, p.y);
        });
        ctx.restore();
      },
    };
    const crosshair: Plugin<'line'> = {
      id: 'crosshair',
      afterDraw(chart) {
        const a = chart.tooltip?.getActiveElements?.() ?? [];
        if (!a.length) return;
        const { ctx, chartArea } = chart;
        ctx.save(); ctx.strokeStyle = theme.reference; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(a[0].element.x, chartArea.top); ctx.lineTo(a[0].element.x, chartArea.bottom); ctx.stroke();
        ctx.restore();
      },
    };
    const config: ChartConfiguration<'line'> = {
      type: 'line',
      data: {
        labels,
        datasets: series.map((s, i) => ({
          label: s.label, data: s.data,
          borderColor: colors[i], backgroundColor: colors[i], borderWidth: 2, tension: 0.25,
          pointRadius: labels.length > 20 ? 2.5 : 4, pointHoverRadius: 6,
          pointBorderColor: labels.map((_, k) => (partialLast && k === last ? colors[i] : theme.surface)), pointBorderWidth: 2,
          // Today's point is hollow and the segment into it dashed: the day isn't over.
          pointBackgroundColor: labels.map((_, k) => (partialLast && k === last ? theme.surface : colors[i])),
          pointStyle: 'circle',
          segment: { borderDash: (ctx) => (partialLast && ctx.p1DataIndex === last ? [4, 4] : undefined) },
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        layout: { padding: { right: 16 } },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { grid: { display: false }, border: { color: theme.grid },
               ticks: { color: theme.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 7, font: { size: 11 } } },
          y: { beginAtZero: true, border: { display: false }, grid: { color: theme.grid },
               ticks: { color: theme.muted, maxTicksLimit: 5, font: { size: 11 }, callback: (v) => format(Number(v)) } },
        },
        plugins: {
          legend: { display: series.length > 1, position: 'top', align: 'start',
            labels: { color: theme.text, boxWidth: 14, boxHeight: 2, font: { size: 12 } } },
          tooltip: {
            backgroundColor: theme.dark ? '#2a3550' : '#ffffff', titleColor: theme.text, bodyColor: theme.text,
            borderColor: theme.grid, borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true,
            callbacks: {
              title: (items) => (items[0] ? `${items[0].label}${partialLast && items[0].dataIndex === last ? ' (so far)' : ''}` : ''),
              label: (c) => ` ${c.dataset.label}: ${format(Number(c.raw))}`,
            },
          },
        },
      },
      plugins: [endLabels, crosshair],
    };
    const chart = new Chart(canvas.current, config);
    return () => chart.destroy();
  }, [labels, series, format, partialLast, theme, hues.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <figure className="chart-card">
      <figcaption className="chart-title">{title}</figcaption>
      <div className="chart-box"><canvas ref={canvas} role="img" aria-label={title} /></div>
      {(note || partialLast) && <div className="chart-note">{[partialLast && 'Dashed: today so far.', note].filter(Boolean).join(' ')}</div>}
    </figure>
  );
}
