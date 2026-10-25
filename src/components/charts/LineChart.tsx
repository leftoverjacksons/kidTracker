import { CategoryScale, Chart, Filler, Legend, LinearScale, LineController, LineElement, PointElement, Tooltip, type ChartConfiguration, type Plugin } from 'chart.js';
import { useEffect, useRef } from 'react';
import { hourStep } from './BarChart';
import { useChartTheme, type Hue } from './theme';

Chart.register(LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend, Filler);

/** null = no value that day (a gap in the line, e.g. no sleep logged). */
export interface LineSeries { label: string; short?: string; data: (number | null)[]; /** Line width (default 2). */ width?: number }

/**
 * Daily line chart (one value per day per series). Legend plus a short direct label at
 * each line's end; crosshair + tooltip on touch. When `partialLast`, the segment into
 * today is dashed and today's point hollow, since the day isn't over. `stacked` draws
 * shaded areas stacked on each other (the top line is the total).
 */
export default function LineChart({ title, labels, series, hues, format, partialLast = false, note, stacked = false, minutesAxis = false, integer = false, band }: {
  title: string; labels: string[]; series: LineSeries[]; hues: Hue[]; format: (v: number) => string;
  partialLast?: boolean; note?: string; stacked?: boolean;
  /** Shaded goal band per day (null = none that day), labelled in the legend row. */
  band?: { from: (number | null)[]; to: (number | null)[]; label: string };
  /** Values are minutes: ticks on whole/half hours. */ minutesAxis?: boolean;
  /** Whole-number ticks (counts). */ integer?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const theme = useChartTheme();

  useEffect(() => {
    if (!canvas.current) return;
    const last = labels.length - 1;
    const colors = hues.map((h) => theme.hue[h]);
    const shade = (c: string) => c + (theme.dark ? '59' : '47'); // ~35% / 28% fill under stacked lines
    const totals = labels.map((_, k) => series.reduce((a, s) => (stacked ? a + (s.data[k] ?? 0) : Math.max(a, s.data[k] ?? 0)), 0));
    const stepSize = minutesAxis ? hourStep(Math.max(1, ...totals)) : undefined;
    // Direct labels ("L", "R") just right of each line's last point.
    const endLabels: Plugin<'line'> = {
      id: 'endLabels',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        ctx.save();
        ctx.font = '600 11px system-ui, sans-serif'; ctx.fillStyle = theme.text; ctx.textBaseline = 'middle';
        // Each label sits at its line's last point; labels closer than 13px are pushed apart.
        const labs = chart.data.datasets.map((_, i) => {
          const pts = chart.getDatasetMeta(i).data;
          const p = pts[pts.length - 1];
          return p && !(p as unknown as { skip?: boolean }).skip && Number.isFinite(p.y) && series[i].short
            ? { text: series[i].short!, x: p.x + 8, y: p.y } : null;
        }).filter((l): l is { text: string; x: number; y: number } => l != null).sort((p, q) => p.y - q.y);
        for (let k = 1; k < labs.length; k++) labs[k].y = Math.max(labs[k].y, labs[k - 1].y + 13);
        const over = labs.length ? labs[labs.length - 1].y - (chart.chartArea.bottom + 6) : 0;
        if (over > 0) labs.forEach((l) => { l.y -= over; });
        labs.forEach((l) => ctx.fillText(l.text, l.x, l.y));
        ctx.restore();
      },
    };
    const goalBand: Plugin<'line'> = {
      id: 'goalBand',
      beforeDatasetsDraw(chart) {
        if (!band) return;
        const { ctx, scales } = chart;
        const pts = labels.map((_, k) => (band.from[k] != null && band.to[k] != null
          ? { x: scales.x.getPixelForValue(k), lo: scales.y.getPixelForValue(band.from[k]!), hi: scales.y.getPixelForValue(band.to[k]!) } : null));
        ctx.save();
        ctx.fillStyle = theme.dark ? 'rgba(233,238,251,0.09)' : 'rgba(19,33,63,0.08)';
        // One filled run per stretch of consecutive days that have a band.
        let run: { x: number; lo: number; hi: number }[] = [];
        const flush = () => {
          if (run.length) {
            const r = run.length === 1 ? [{ ...run[0], x: run[0].x - 6 }, { ...run[0], x: run[0].x + 6 }] : run;
            ctx.beginPath();
            r.forEach((p, i) => (i ? ctx.lineTo(p.x, p.hi) : ctx.moveTo(p.x, p.hi)));
            [...r].reverse().forEach((p) => ctx.lineTo(p.x, p.lo));
            ctx.closePath(); ctx.fill();
          }
          run = [];
        };
        pts.forEach((p) => (p ? run.push(p) : flush()));
        flush();
        ctx.restore();
      },
      // Dashed edges drawn over the data, so the target stays visible above stacked areas.
      afterDatasetsDraw(chart) {
        if (!band) return;
        const { ctx, scales } = chart;
        ctx.save();
        ctx.strokeStyle = theme.dark ? 'rgba(233,238,251,0.75)' : 'rgba(19,33,63,0.7)';
        ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
        for (const edge of [band.from, band.to]) {
          ctx.beginPath();
          let on = false;
          edge.forEach((v, k) => {
            if (v == null) { on = false; return; }
            const x = scales.x.getPixelForValue(k), y = scales.y.getPixelForValue(v);
            if (on) ctx.lineTo(x, y); else { ctx.moveTo(x, y); on = true; }
          });
          ctx.stroke();
        }
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
          borderColor: colors[i], backgroundColor: stacked ? shade(colors[i]) : colors[i], borderWidth: s.width ?? 2, tension: 0.3, cubicInterpolationMode: 'monotone', // no overshoot between points
          fill: stacked ? (i === 0 ? 'origin' : '-1') : false, spanGaps: false,
          pointRadius: labels.length > 20 ? 2.5 : 4, pointHoverRadius: 6,
          pointBorderColor: labels.map((_, k) => (partialLast && k === last ? colors[i] : theme.surface)), pointBorderWidth: 2,
          // Today's point is hollow and the segment into it dashed: the day isn't over.
          pointBackgroundColor: labels.map((_, k) => (partialLast && k === last ? theme.surface : colors[i])),
          pointStyle: 'circle',
          segment: { borderDash: (ctx) => (partialLast && ctx.p1DataIndex === last ? [4, 4] : undefined) },
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false, ...(theme.dpr ? { devicePixelRatio: theme.dpr } : {}), animation: false,
        layout: { padding: { right: Math.max(16, ...series.map((s) => (s.short?.length ?? 0) * 7 + 10)) } },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { stacked, grid: { display: false }, border: { color: theme.grid },
               ticks: { color: theme.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 7, font: { size: 11 } } },
          y: { stacked, beginAtZero: true, suggestedMax: band ? Math.max(0, ...band.to.map((v) => v ?? 0)) * 1.1 : undefined, border: { display: false }, grid: { color: theme.grid },
               ticks: { color: theme.muted, maxTicksLimit: 5, font: { size: 11 }, precision: integer ? 0 : undefined, stepSize, callback: (v) => format(Number(v)) } },
        },
        plugins: {
          legend: { display: series.length > 1, position: 'top', align: 'start',
            labels: { color: theme.text, boxWidth: stacked ? 10 : 14, boxHeight: stacked ? 10 : 2, font: { size: 12 } } },
          tooltip: {
            backgroundColor: theme.dark ? '#2a3550' : '#ffffff', titleColor: theme.text, bodyColor: theme.text,
            borderColor: theme.grid, borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true,
            callbacks: {
              title: (items) => (items[0] ? `${items[0].label}${partialLast && items[0].dataIndex === last ? ' (so far)' : ''}` : ''),
              label: (c) => (c.raw == null ? '' : ` ${series.length > 1 ? `${c.dataset.label}: ` : ''}${format(Number(c.raw))}`),
              footer: (items) => (stacked && items.length > 1 ? `Total: ${format(items.reduce((a, c) => a + Number(c.raw ?? 0), 0))}` : ''),
            },
          },
        },
      },
      plugins: [goalBand, endLabels, crosshair],
    };
    const chart = new Chart(canvas.current, config);
    return () => chart.destroy();
  }, [labels, series, format, partialLast, theme, hues.join(), stacked, minutesAxis, integer, band]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <figure className="chart-card">
      <figcaption className="chart-title">{title}</figcaption>
      {band && <div className="chart-legend-inline"><span><i className="band-swatch" />{band.label}</span></div>}
      <div className="chart-box"><canvas ref={canvas} role="img" aria-label={title} /></div>
      {(note || partialLast) && <div className="chart-note">{[partialLast && 'Dashed: today so far.', note].filter(Boolean).join(' ')}</div>}
    </figure>
  );
}
