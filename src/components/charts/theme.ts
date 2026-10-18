import { useEffect, useState } from 'react';

/**
 * Categorical slots taken from the Home tiles: Sleep periwinkle, then Nurse rose
 * (2026-10-18). Validated with the dataviz checker against the chart-card
 * surfaces (#eef1f8 light, #1c2438 dark): lightness band, CVD and contrast all pass.
 */
export const SLOTS = {
  light: ['#5b6fe0', '#d9638e'],
  dark: ['#6d7fec', '#d9688f'],
};

export interface ChartTheme {
  dark: boolean;
  series: string[];
  /** Diverging poles (validated pair): above / below a reference. */
  gain: string;
  loss: string;
  surface: string;
  text: string;
  muted: string;
  grid: string;
  reference: string;
}

export function useChartTheme(): ChartTheme {
  const q = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => window.matchMedia?.(q).matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const on = () => setDark(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return dark
    ? { dark, series: SLOTS.dark, gain: SLOTS.dark[0], loss: SLOTS.dark[1], surface: '#1c2438', text: '#e8ecf6', muted: '#a3adc6', grid: '#2d3852', reference: '#5d6886' }
    : { dark, series: SLOTS.light, gain: SLOTS.light[0], loss: SLOTS.light[1], surface: '#eef1f8', text: '#1f2a44', muted: '#5f6a85', grid: '#dbe1ee', reference: '#a7b1c9' };
}
