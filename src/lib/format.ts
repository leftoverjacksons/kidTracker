import type { HouseholdSettings } from './types';
import { cmToIn, cToF, gToLbOz, mlToOz } from './units';

const round1 = (n: number) => Math.round(n * 10) / 10;
const trim = (n: number) => String(round1(n)).replace(/\.0$/, '');

export function formatVolume(ml: number | null | undefined, s: HouseholdSettings): string {
  if (ml == null) return '';
  return s.volume_unit === 'oz' ? `${trim(mlToOz(ml))} oz` : `${Math.round(ml)} ml`;
}

/** Bottle flow rate, from ml per minute, in the display unit. */
export function formatFlow(mlPerMin: number, s: HouseholdSettings): string {
  return s.volume_unit === 'oz' ? `${(mlToOz(mlPerMin)).toFixed(2)} oz/min` : `${mlPerMin.toFixed(1)} ml/min`;
}

export function formatTemp(c: number | null | undefined, s: HouseholdSettings): string {
  if (c == null) return '';
  return s.temp_unit === 'F' ? `${trim(cToF(c))} °F` : `${trim(c)} °C`;
}

export function formatWeight(g: number | null | undefined, s: HouseholdSettings): string {
  if (g == null) return '';
  if (s.weight_unit === 'kg') return `${(g / 1000).toFixed(2)} kg`;
  const { lb, oz } = gToLbOz(g);
  return `${lb} lb ${trim(oz)} oz`;
}

export function formatLength(cm: number | null | undefined, s: HouseholdSettings): string {
  if (cm == null) return '';
  return s.length_unit === 'in' ? `${trim(cmToIn(cm))} in` : `${trim(cm)} cm`;
}

/** 0:42, 12:05, 1:02:09 — live timer display. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** "45m", "1h 20m", "0m". */
export function formatDuration(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

/** "just now", "12m ago", "2h 5m ago", "3d ago". */
export function formatAgo(from: Date, now: Date = new Date()): string {
  const ms = now.getTime() - from.getTime();
  if (ms < 60_000) return 'just now';
  if (ms >= 2 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`;
  return `${formatDuration(ms)} ago`;
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatDayHeading(d: Date, now: Date = new Date()): string {
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

/** Date → value for <input type="datetime-local"> in the phone's time zone. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value → Date (local time), or null if blank/invalid. */
export function fromLocalInput(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "6:30 PM" today, "tomorrow 6:30 PM", or "Tue 6:30 PM". */
export function formatWhen(d: Date, now: Date = new Date()): string {
  const days = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 86_400_000);
  if (days === 0) return formatTime(d);
  if (days === 1) return `tomorrow ${formatTime(d)}`;
  return `${d.toLocaleDateString([], { weekday: 'short' })} ${formatTime(d)}`;
}
