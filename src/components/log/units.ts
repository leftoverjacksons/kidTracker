import type { HouseholdSettings } from '../../lib/types';
import { cmToIn, cToF, fToC, inToCm, mlToOz, ozToMl } from '../../lib/units';

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Display-unit ↔ storage-unit helpers for form fields. */
export const vol = (s: HouseholdSettings) => ({
  unit: s.volume_unit,
  toStore: (v: number) => (s.volume_unit === 'oz' ? ozToMl(v) : v),
  toShow: (ml: number) => r1(s.volume_unit === 'oz' ? mlToOz(ml) : ml),
  quick: s.volume_unit === 'oz' ? [1, 2, 3, 4, 5] : [30, 60, 90, 120, 150],
  /** Typical amounts left in a bottle. */
  leftQuick: s.volume_unit === 'oz' ? [0, 0.5, 1, 1.5, 2] : [0, 15, 30, 45, 60],
});

export const temp = (s: HouseholdSettings) => ({
  unit: s.temp_unit === 'F' ? '°F' : '°C',
  toStore: (v: number) => (s.temp_unit === 'F' ? fToC(v) : v),
  toShow: (c: number) => r1(s.temp_unit === 'F' ? cToF(c) : c),
  plausible: (v: number) => (s.temp_unit === 'F' ? v >= 90 && v <= 110 : v >= 32 && v <= 43.5),
});

export const len = (s: HouseholdSettings) => ({
  unit: s.length_unit,
  toStore: (v: number) => (s.length_unit === 'in' ? inToCm(v) : v),
  toShow: (cm: number) => r1(s.length_unit === 'in' ? cmToIn(cm) : cm),
});
