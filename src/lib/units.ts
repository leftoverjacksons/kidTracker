// Storage is metric (ml, °C, g, cm); these convert for display and entry.

export const ML_PER_OZ = 29.5735; // US fluid ounce
export const G_PER_LB = 453.59237;
export const CM_PER_IN = 2.54;

export const mlToOz = (ml: number) => ml / ML_PER_OZ;
export const ozToMl = (oz: number) => oz * ML_PER_OZ;

export const cToF = (c: number) => (c * 9) / 5 + 32;
export const fToC = (f: number) => ((f - 32) * 5) / 9;

export const cmToIn = (cm: number) => cm / CM_PER_IN;
export const inToCm = (inches: number) => inches * CM_PER_IN;

/** Grams → whole pounds and remaining ounces (1 decimal). */
export function gToLbOz(g: number): { lb: number; oz: number } {
  const totalOz = Math.round((g / G_PER_LB) * 16 * 10) / 10;
  const lb = Math.floor(totalOz / 16);
  return { lb, oz: Math.round((totalOz - lb * 16) * 10) / 10 };
}
export const lbOzToG = (lb: number, oz: number) => (lb + oz / 16) * G_PER_LB;

/** Human age from a birth date, e.g. "5 days", "3 weeks", "4 months". */
export function ageLabel(birthDate: string, now = new Date()): string {
  const [y, m, d] = birthDate.split('-').map(Number);
  const born = new Date(y, m - 1, d);
  const days = Math.floor((now.getTime() - born.getTime()) / 86_400_000);
  if (days < 0) return 'not born yet';
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 8 * 7) return `${Math.floor(days / 7)} weeks`;
  let months = (now.getFullYear() - y) * 12 + (now.getMonth() - (m - 1));
  if (now.getDate() < d) months -= 1;
  if (months < 24) return `${months} months`;
  return `${Math.floor(months / 12)} years`;
}
