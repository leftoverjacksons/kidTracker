import type { EventRow } from './types';

export type BlockKind = 'sleep' | 'nursing' | 'bottle' | 'diaper';

export interface Column {
  start: Date; // inclusive
  end: Date;   // exclusive
}

export interface Block {
  event: EventRow;
  kind: BlockKind;
  /** Fraction of the column height, 0 = column start. */
  top: number;
  bottom: number;
  /** Started earlier than the column (continues from the previous one). */
  clippedTop: boolean;
  /** Continues into the next column (or is still running). */
  clippedBottom: boolean;
  /** Overlaps an earlier block in the same column: drawn narrower, on top. */
  narrow: boolean;
  running: boolean;
}

const DAY = 86_400_000;
export const SNAP_MIN = 5;

/** Start of the column (day window) containing `t`, for a day that begins at `cutoffHour`. */
export function columnStartFor(t: Date, cutoffHour: number): Date {
  const s = new Date(t.getFullYear(), t.getMonth(), t.getDate(), cutoffHour);
  if (s > t) s.setDate(s.getDate() - 1);
  return s;
}

/** Seven consecutive day columns, the last one containing `now` shifted back by `weekOffset` weeks. */
export function weekColumns(now: Date, cutoffHour: number, weekOffset = 0): Column[] {
  const last = columnStartFor(now, cutoffHour);
  return Array.from({ length: 7 }, (_, i) => {
    const start = new Date(last);
    start.setDate(start.getDate() - (6 - i) - 7 * weekOffset);
    const end = new Date(start);
    end.setDate(end.getDate() + 1); // calendar day, so DST days are 23/25 h
    return { start, end };
  });
}

function kindOf(e: EventRow): BlockKind | null {
  switch (e.type) {
    case 'sleep': return 'sleep';
    case 'nursing': return 'nursing';
    case 'bottle': return 'bottle';
    case 'diaper': return 'diaper';
    default: return null;
  }
}

/**
 * Blocks for one column. Durations are clipped to the column; running entries extend to `now`.
 * `minFrac` is the smallest drawn height (as a fraction of the column), so very short entries
 * that would visually overlap are also treated as overlapping.
 */
export function columnBlocks(events: EventRow[], col: Column, now: Date, minFrac = 0): Block[] {
  const span = col.end.getTime() - col.start.getTime();
  const blocks: Block[] = [];
  for (const e of events) {
    const kind = kindOf(e);
    if (!kind) continue;
    const s = new Date(e.started_at).getTime();
    const instant = kind === 'bottle' || kind === 'diaper';
    const running = !instant && !e.ended_at;
    const en = instant ? s : running ? now.getTime() : new Date(e.ended_at!).getTime();
    if (instant ? s < col.start.getTime() || s >= col.end.getTime()
                : en <= col.start.getTime() || s >= col.end.getTime()) continue;
    const a = Math.max(s, col.start.getTime()), b = Math.min(en, col.end.getTime());
    blocks.push({
      event: e, kind,
      top: (a - col.start.getTime()) / span, bottom: (b - col.start.getTime()) / span,
      clippedTop: s < col.start.getTime(), clippedBottom: running || en > col.end.getTime(),
      narrow: false, running,
    });
  }
  // Duration blocks that overlap an earlier one are drawn narrower so both stay visible.
  const timed = blocks.filter((b) => b.kind === 'sleep' || b.kind === 'nursing').sort((x, y) => x.top - y.top);
  let reach = -1;
  for (const b of timed) {
    if (b.top < reach - 1e-9) b.narrow = true;
    reach = Math.max(reach, b.bottom, b.top + minFrac);
  }
  return blocks;
}

/** Round a time to the nearest SNAP_MIN minutes. */
export function snap(t: Date): Date {
  const step = SNAP_MIN * 60_000;
  return new Date(Math.round(t.getTime() / step) * step);
}

/** Hour labels down the side, every `every` hours from the cutoff. */
export function hourTicks(cutoffHour: number, every = 3): { frac: number; label: string }[] {
  const out: { frac: number; label: string }[] = [];
  for (let h = 0; h <= 24; h += every) {
    const hr = (cutoffHour + h) % 24;
    const label = hr === 0 ? '12a' : hr === 12 ? '12p' : hr < 12 ? `${hr}a` : `${hr - 12}p`;
    out.push({ frac: h / 24, label });
  }
  return out;
}

export const msPerDay = DAY;
