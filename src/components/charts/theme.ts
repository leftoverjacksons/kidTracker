import { useEffect, useState } from 'react';

/** Validated categorical slots (dataviz reference palette, checked on #fff / #121212). */
export const SLOTS = {
  light: ['#2a78d6', '#eb6834'],
  dark: ['#3987e5', '#d95926'],
};

export interface ChartTheme {
  dark: boolean;
  series: string[];
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
    ? { dark, series: SLOTS.dark, surface: '#121212', text: '#f0efec', muted: '#a8a79f', grid: '#2a2a28', reference: '#5c5b56' }
    : { dark, series: SLOTS.light, surface: '#ffffff', text: '#0b0b0b', muted: '#6b6a65', grid: '#ebeae6', reference: '#b9b8b1' };
}
