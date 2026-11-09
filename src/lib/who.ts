import { WHO_LMS, type Measure, type Sex } from './who-data';

export type { Measure, Sex };

/** Average days per month used by WHO (365.25 / 12). */
export const DAYS_PER_MONTH = 30.4375;

/** L, M, S at a fractional age in months (linear interpolation between monthly rows). */
export function lmsAt(sex: Sex, measure: Measure, months: number): [number, number, number] | null {
  const rows = WHO_LMS[sex][measure];
  if (months < 0 || months > rows.length - 1) return null;
  const i = Math.min(Math.floor(months), rows.length - 2);
  const f = months - i;
  const a = rows[i], b = rows[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** Measurement value at a given z-score (LMS method). */
export function valueAtZ([L, M, S]: [number, number, number], z: number): number {
  return L === 0 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L);
}

/** z-score of a measurement (LMS method). */
export function zScore([L, M, S]: [number, number, number], x: number): number {
  return L === 0 ? Math.log(x / M) / S : (Math.pow(x / M, L) - 1) / (L * S);
}

/** Standard normal CDF (Abramowitz & Stegun 26.2.17; error < 7.5e-8). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

/** Percentile (0–100) of a measurement in WHO units (kg or cm), or null outside 0–24 months. */
export function percentile(sex: Sex, measure: Measure, months: number, x: number): number | null {
  const lms = lmsAt(sex, measure, months);
  return lms ? normalCdf(zScore(lms, x)) * 100 : null;
}

/** z-scores for the reference curves drawn on growth charts. */
export const CURVES: { label: string; z: number }[] = [
  { label: '3rd', z: -1.8808 }, { label: '15th', z: -1.0364 }, { label: '50th', z: 0 },
  { label: '85th', z: 1.0364 }, { label: '97th', z: 1.8808 },
];

export function ageInMonths(birthDate: string, at: Date): number {
  const [y, m, d] = birthDate.split('-').map(Number);
  return (at.getTime() - new Date(y, m - 1, d).getTime()) / 86_400_000 / DAYS_PER_MONTH;
}

/** The rapid-gain threshold: an upward change in weight-for-age z of more than this (Ong 2000; Zheng 2017). */
export const RAPID_GAIN_Z = 0.67;

export type GuardBaseline = 'birth' | '24h' | '2w';

/**
 * Rapid-gain guard for weight (design doc §8a AB): a reference weight's weight-for-age z ± 0.67.
 * Gaining above the top edge is "rapid infant weight gain", which studies link with later
 * overweight; dropping below the bottom edge is a fall in percentile worth asking about too.
 * The reference (`baseline`):
 * - 'birth': the first weight, if logged within 2 days of the birth date;
 * - '24h': the weight closest to 24 h after the birth weight, 12–48 h after it (newborns whose
 *   mothers had IV fluids can be born carrying extra fluid; Noel-Weiss et al. 2011 suggest the
 *   24-hour weight as the baseline instead);
 * - '2w': the weight closest to 14 days old, 10–21 days (after the newborn dip).
 * Points are { months, value (kg) }, oldest first. Returns which weight is missing if there isn't one.
 */
export function weightGuard(sex: Sex, points: { months: number; value: number }[], baseline: GuardBaseline = 'birth'):
  { z0: number; lo: number; hi: number; zNow: number; change: number; ref: { months: number; value: number } } | { missing: GuardBaseline } {
  const day = 1 / DAYS_PER_MONTH;
  const closest = (target: number, from: number, to: number) => points.filter((p) => p.months >= from && p.months <= to)
    .sort((a, b) => Math.abs(a.months - target) - Math.abs(b.months - target))[0];
  const birth = points[0] && points[0].months <= 2 * day ? points[0] : undefined;
  const ref = baseline === 'birth' ? birth
    : baseline === '24h' ? (birth && closest(birth.months + day, birth.months + 0.5 * day, birth.months + 2 * day))
    : closest(14 * day, 10 * day, 21 * day);
  const z = (p: { months: number; value: number }) => { const lms = lmsAt(sex, 'weight', p.months); return lms ? zScore(lms, p.value) : null; };
  const z0 = ref && z(ref), zNow = points.length ? z(points[points.length - 1]) : null;
  if (!ref || z0 == null || zNow == null) return { missing: baseline };
  return { z0, lo: z0 - RAPID_GAIN_Z, hi: z0 + RAPID_GAIN_Z, zNow, change: zNow - z0, ref };
}

/** Width of the WHO chart (months) so that `age` sits three quarters of the way across. */
export function chartMonths(age: number): number {
  return Math.min(24, Math.max(7 / DAYS_PER_MONTH, age / 0.75));
}

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 11 → "11th", 22 → "22nd". */
export function ordinal(n: number): string {
  const t = n % 100, u = n % 10;
  return `${n}${t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th'}`;
}
