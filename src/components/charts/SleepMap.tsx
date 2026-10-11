import { formatDuration, formatTime } from '../../lib/format';
import type { EventRow } from '../../lib/types';
import { useChartTheme } from './theme';

/**
 * 24-hour sleep map: one row per day (newest at the bottom), sleep drawn as
 * bars from midnight to midnight. Running sleeps extend to now.
 */
export default function SleepMap({ events, days, now = new Date() }: { events: EventRow[]; days: Date[]; now?: Date }) {
  const theme = useChartTheme();
  const W = 340, rowH = 16, gap = 4, left = 44, top = 18;
  const plotW = W - left - 6;
  const H = top + days.length * (rowH + gap) + 4;
  const sleeps = events.filter((e) => e.type === 'sleep');
  const x = (h: number) => left + (h / 24) * plotW;

  return (
    <figure className="chart-card">
      <figcaption className="chart-title">Sleep map</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Sleep by time of day">
        {[0, 6, 12, 18, 24].map((h) => (
          <g key={h}>
            <line x1={x(h)} x2={x(h)} y1={top - 4} y2={H} stroke={theme.grid} strokeWidth={1} />
            <text x={x(h)} y={10} fontSize={10} fill={theme.muted} textAnchor="middle">
              {h === 0 || h === 24 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const y = top + i * (rowH + gap);
          const dayStart = d.getTime(), dayEnd = dayStart + 86_400_000;
          return (
            <g key={dayStart}>
              <text x={0} y={y + rowH - 4} fontSize={10} fill={theme.muted}>
                {d.toLocaleDateString([], { weekday: 'short' })} {d.getDate()}
              </text>
              {sleeps.map((e) => {
                const s = new Date(e.started_at).getTime();
                const en = e.ended_at ? new Date(e.ended_at).getTime() : now.getTime();
                const a = Math.max(s, dayStart), b = Math.min(en, dayEnd);
                if (b <= a) return null;
                const x1 = x((a - dayStart) / 3_600_000), x2 = x((b - dayStart) / 3_600_000);
                return (
                  <rect key={e.id} x={x1} y={y} width={Math.max(2, x2 - x1)} height={rowH} rx={3} fill={theme.series[0]}>
                    <title>{`${formatTime(new Date(s))}–${e.ended_at ? formatTime(new Date(en)) : 'now'} (${formatDuration(en - s)})`}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
