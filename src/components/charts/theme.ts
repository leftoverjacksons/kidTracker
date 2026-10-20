import { createContext, useContext, useEffect, useState } from 'react';

/**
 * Colours from the illustrated icon set (2026-10-19): blue, coral, teal, amber.
 * Only these pairs are used together in one chart, and each was validated with the
 * dataviz checker on the card surfaces (#fbf6ec light, #14213d dark):
 * blue+coral, blue+amber, teal+coral. Amber and coral are never paired (too close for CVD).
 */
export const PALETTE = {
  light: { blue: '#2f74e8', coral: '#e2553a', teal: '#0b8f80', amber: '#b97c0c' },
  dark: { blue: '#4b8dfc', coral: '#e85e42', teal: '#12a896', amber: '#bd8216' },
};
export type Hue = keyof typeof PALETTE.light;

export interface ChartTheme {
  dark: boolean;
  /** Default series order: blue, coral. */
  series: string[];
  hue: Record<Hue, string>;
  /** Diverging poles (validated pair): above / below a reference. */
  gain: string;
  loss: string;
  surface: string;
  text: string;
  muted: string;
  grid: string;
  reference: string;
  /** Set inside the printable summary: render the canvas at this pixel ratio so it prints sharply. */
  dpr?: number;
}

/** True inside the pediatrician summary: charts always use the light colours on white paper. */
export const PrintCharts = createContext(false);

export function useChartTheme(): ChartTheme {
  const print = useContext(PrintCharts);
  const q = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => window.matchMedia?.(q).matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const on = () => setDark(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  if (print) {
    const h = PALETTE.light;
    return { dark: false, hue: h, series: [h.blue, h.coral], gain: h.teal, loss: h.coral, dpr: 3,
      surface: '#ffffff', text: '#111111', muted: '#555555', grid: '#e6e6e6', reference: '#bbbbbb' };
  }
  const h = dark ? PALETTE.dark : PALETTE.light;
  const base = { dark, hue: h, series: [h.blue, h.coral], gain: h.teal, loss: h.coral };
  return dark
    ? { ...base, surface: '#14213d', text: '#e9eefb', muted: '#a3afcb', grid: '#263556', reference: '#56658a' }
    : { ...base, surface: '#fbf6ec', text: '#13213f', muted: '#6a6556', grid: '#ece3d0', reference: '#c4b99f' };
}
