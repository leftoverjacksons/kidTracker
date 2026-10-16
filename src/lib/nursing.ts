import type { NursingSegment } from './types';

/** Milliseconds per side; an open segment counts up to `now`. */
export function sideTotals(segments: NursingSegment[], now: Date = new Date()): { left: number; right: number } {
  const t = { left: 0, right: 0 };
  for (const s of segments) {
    const end = s.ended_at ? new Date(s.ended_at) : now;
    t[s.side] += Math.max(0, end.getTime() - new Date(s.started_at).getTime());
  }
  return t;
}

export function activeSide(segments: NursingSegment[]): 'left' | 'right' | null {
  return segments.find((s) => !s.ended_at)?.side ?? null;
}

/** Side of the most recently started segment ("last side" indicator). */
export function lastSide(segments: NursingSegment[]): 'left' | 'right' | null {
  let best: NursingSegment | null = null;
  for (const s of segments) if (!best || s.started_at > best.started_at) best = s;
  return best?.side ?? null;
}

/**
 * Segments for a manually entered feed: sides back to back from `start`,
 * first side first. Zero-minute sides are skipped.
 */
export function manualSegments(
  start: Date, leftMin: number, rightMin: number, first: 'left' | 'right',
): { side: 'left' | 'right'; started_at: Date; ended_at: Date }[] {
  const order: ('left' | 'right')[] = first === 'left' ? ['left', 'right'] : ['right', 'left'];
  const mins = { left: leftMin, right: rightMin };
  const out: { side: 'left' | 'right'; started_at: Date; ended_at: Date }[] = [];
  let t = start.getTime();
  for (const side of order) {
    if (mins[side] > 0) {
      const end = t + mins[side] * 60_000;
      out.push({ side, started_at: new Date(t), ended_at: new Date(end) });
      t = end;
    }
  }
  return out;
}

/** Side of the earliest segment. */
export function firstSide(segments: NursingSegment[]): 'left' | 'right' | null {
  let best: NursingSegment | null = null;
  for (const s of segments) if (!best || s.started_at < best.started_at) best = s;
  return best?.side ?? null;
}

/** Gap (minutes) under which back-to-back nursing entries count as one feed. */
export const FEED_GAP_MIN = 20;

/**
 * Start time of the most recent feed, treating nursing entries that begin within
 * FEED_GAP_MIN of the previous one's end as the same feed. `events` must be
 * newest first; only finished nursing entries are considered.
 * (Display only; the report views still count entries until the SQL grouping lands.)
 */
export function lastFeedStart(events: { type: string; started_at: string; ended_at: string | null }[]): Date | null {
  const nursing = events.filter((e) => e.type === 'nursing' && e.ended_at);
  if (!nursing.length) return null;
  let start = new Date(nursing[0].started_at);
  for (const e of nursing.slice(1)) {
    const gap = start.getTime() - new Date(e.ended_at!).getTime();
    if (gap > FEED_GAP_MIN * 60_000) break;
    start = new Date(Math.min(start.getTime(), new Date(e.started_at).getTime()));
  }
  return start;
}
