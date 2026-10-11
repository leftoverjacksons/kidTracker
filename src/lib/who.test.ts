import { describe, expect, it } from 'vitest';
import { lmsAt, percentile, valueAtZ } from './who';

describe('WHO growth standards', () => {
  it('median boy weight at birth is 3.3464 kg (published M)', () => {
    expect(lmsAt('male', 'weight', 0)?.[1]).toBeCloseTo(3.3464, 4);
    expect(percentile('male', 'weight', 0, 3.3464)).toBeCloseTo(50, 1);
  });
  it('reproduces published percentile values', () => {
    // Girls weight-for-age, 24 months: 5th = 9.416516, 95th = 14.16181 (CDC/WHO table)
    const lms = lmsAt('female', 'weight', 24)!;
    expect(valueAtZ(lms, -1.6449)).toBeCloseTo(9.4165, 2);
    expect(valueAtZ(lms, 1.6449)).toBeCloseTo(14.1618, 2);
    expect(percentile('female', 'weight', 24, 9.416516)).toBeCloseTo(5, 0);
  });
  it('interpolates between months and rejects ages outside 0–24', () => {
    const a = lmsAt('male', 'length', 1)![1], b = lmsAt('male', 'length', 2)![1];
    expect(lmsAt('male', 'length', 1.5)![1]).toBeCloseTo((a + b) / 2, 6);
    expect(percentile('male', 'head', 25, 45)).toBeNull();
    expect(percentile('male', 'head', -0.1, 35)).toBeNull();
  });
});
