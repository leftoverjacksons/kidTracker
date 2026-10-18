import { useChartTheme } from './charts/theme';
import { PUMP_TARGET } from '../lib/pump';

const GOOD = '#0ca30c'; // status "good" (reserved for meaning; paired with the number + label)

/** Point on a circle; angle in degrees, 0 = 12 o'clock, clockwise. */
function pt(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const [x1, y1] = pt(cx, cy, r, from), [x2, y2] = pt(cx, cy, r, to);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

/**
 * One breast's pumping gauge: a 270° dial filling toward the 8–12 target band
 * (marked on the outer edge), with the session count in the round centre.
 */
export default function PumpGauge({ count, side, selected = false }: { count: number; side: 'L' | 'R'; selected?: boolean }) {
  const theme = useChartTheme();
  const S = 60, c = S / 2, r = 22;
  const START = -135, SWEEP = 270, MAX = PUMP_TARGET.max;
  const at = (n: number) => START + (Math.min(n, MAX) / MAX) * SWEEP;
  const onTarget = count >= PUMP_TARGET.min;
  const fill = onTarget ? GOOD : theme.series[0];
  const areola = theme.series[1] + '40'; // warm, soft centre
  return (
    <svg className="pump-gauge" viewBox={`0 0 ${S} ${S + 10}`} role="img"
      aria-label={`${side === 'L' ? 'Left' : 'Right'}: ${count} pumping sessions of 15+ minutes in the last 24 hours (target ${PUMP_TARGET.min}–${PUMP_TARGET.max})`}>
      <circle cx={c} cy={c} r={r + 7} fill={theme.series[1] + '1f'}
        stroke={selected ? theme.text : 'none'} strokeWidth={selected ? 1.5 : 0} />
      <path d={arc(c, c, r, START, START + SWEEP)} stroke={theme.grid} strokeWidth={5} fill="none" strokeLinecap="round" />
      {/* target band 8–12 on the outer edge */}
      <path d={arc(c, c, r + 5.5, at(PUMP_TARGET.min), at(MAX))} stroke={GOOD} strokeWidth={2} fill="none" strokeLinecap="round" opacity={0.8} />
      {count > 0 && <path d={arc(c, c, r, START, Math.max(at(count), START + 4))} stroke={fill} strokeWidth={5} fill="none" strokeLinecap="round" />}
      <circle cx={c} cy={c} r={11.5} fill={areola} />
      <text x={c} y={c + 4.5} textAnchor="middle" fontSize={13} fontWeight={700} fill={theme.text}>{count}</text>
      <text x={c} y={S + 8} textAnchor="middle" fontSize={11} fontWeight={600} fill={theme.muted}>{side}</text>
    </svg>
  );
}
