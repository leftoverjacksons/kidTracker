/** Weight-change series relative to the first (earliest) recorded weight. */
export interface WeightPoint { t: number; grams: number; pct: number }

export interface WeightChange {
  base: WeightPoint;           // earliest weight (pct = 0)
  points: WeightPoint[];       // all weights, oldest first (includes base)
  lowest: WeightPoint;         // minimum pct (largest loss, or base)
  latest: WeightPoint;
  /** Day when weight first got back to ≥ base after having dropped below it; null if not (yet). */
  regainedAt: number | null;
}

export function weightChange(rows: { started_at: string; weight_g: number | string | null }[]): WeightChange | null {
  const pts = rows
    .filter((r) => r.weight_g != null && Number(r.weight_g) > 0)
    .map((r) => ({ t: new Date(r.started_at).getTime(), grams: Number(r.weight_g) }))
    .sort((a, b) => a.t - b.t);
  if (!pts.length) return null;
  const g0 = pts[0].grams;
  const points = pts.map((p) => ({ ...p, pct: ((p.grams - g0) / g0) * 100 }));
  const lowest = points.reduce((m, p) => (p.pct < m.pct ? p : m), points[0]);
  let regainedAt: number | null = null;
  let dipped = false;
  for (const p of points) {
    if (p.pct < 0) dipped = true;
    else if (dipped && p.pct >= 0) { regainedAt = p.t; break; }
  }
  return { base: points[0], points, lowest, latest: points[points.length - 1], regainedAt };
}

/** "+2.4%" / "−6.1%" / "0%". */
export function formatPct(pct: number): string {
  const r = Math.round(pct * 10) / 10;
  if (r === 0) return '0%';
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}%`;
}

/**
 * Gain since he got back to his first (birth) weight: a straight line fitted (least squares)
 * through every weight from the first one back at or above it onward (a later dip stays in,
 * so the trend can't hide it). Needs two weights. gPerDay is the slope; the line runs from
 * the first to the last of those weights.
 */
export function gainTrend(w: WeightChange): { gPerDay: number; n: number; from: WeightPoint; to: WeightPoint; at: (t: number) => number } | null {
  const back = w.points.find((p) => p !== w.base && p.t >= w.lowest.t && p.grams >= w.base.grams);
  const after = back ? w.points.filter((p) => p.t >= back.t) : [];
  if (after.length < 2) return null;
  const DAY = 86_400_000, t0 = after[0].t;
  const xs = after.map((p) => (p.t - t0) / DAY), ys = after.map((p) => p.grams);
  const mx = xs.reduce((a, x) => a + x, 0) / xs.length, my = ys.reduce((a, y) => a + y, 0) / ys.length;
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (sxx === 0) return null; // all on the same moment
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx;
  return { gPerDay: slope, n: after.length, from: after[0], to: after[after.length - 1], at: (t) => my + slope * ((t - t0) / DAY - mx) };
}
