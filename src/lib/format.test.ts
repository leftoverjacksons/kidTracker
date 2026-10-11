import { describe, expect, it } from 'vitest';
import { formatAgo, formatClock, formatDayHeading, formatDuration, formatTemp, formatVolume, formatWeight, fromLocalInput, toLocalInput } from './format';
import { DEFAULT_SETTINGS } from './types';
import { ozToMl } from './units';

const S = DEFAULT_SETTINGS;

describe('format', () => {
  it('volume in oz and ml', () => {
    expect(formatVolume(ozToMl(3), S)).toBe('3 oz');
    expect(formatVolume(ozToMl(2.5), S)).toBe('2.5 oz');
    expect(formatVolume(120, { ...S, volume_unit: 'ml' })).toBe('120 ml');
  });
  it('temperature and weight', () => {
    expect(formatTemp(38, S)).toBe('100.4 °F');
    expect(formatWeight(3402, S)).toBe('7 lb 8 oz');
  });
  it('clock and durations', () => {
    expect(formatClock(42_000)).toBe('0:42');
    expect(formatClock(3_729_000)).toBe('1:02:09');
    expect(formatDuration(80 * 60_000)).toBe('1h 20m');
    expect(formatDuration(120 * 60_000)).toBe('2h');
  });
  it('relative time', () => {
    const now = new Date(2026, 9, 11, 12, 0);
    expect(formatAgo(new Date(2026, 9, 11, 11, 59, 30), now)).toBe('just now');
    expect(formatAgo(new Date(2026, 9, 11, 9, 55), now)).toBe('2h 5m ago');
    expect(formatAgo(new Date(2026, 9, 8, 12, 0), now)).toBe('3d ago');
    expect(formatDayHeading(new Date(2026, 9, 10, 23, 0), now)).toBe('Yesterday');
  });
  it('datetime-local round trip', () => {
    const d = new Date(2026, 9, 11, 7, 5);
    expect(toLocalInput(d)).toBe('2026-10-11T07:05');
    expect(fromLocalInput('2026-10-11T07:05')?.getTime()).toBe(d.getTime());
    expect(fromLocalInput('')).toBeNull();
  });
});
