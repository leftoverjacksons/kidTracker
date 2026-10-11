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
