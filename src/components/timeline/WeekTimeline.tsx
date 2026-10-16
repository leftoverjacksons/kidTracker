import { IonButton, IonIcon, IonSegment, IonSegmentButton, IonSelect, IonSelectOption, useIonToast } from '@ionic/react';
import { add, chevronBack, chevronForward, close, remove } from 'ionicons/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useData, useNow } from '../../lib/data';
import { META } from '../../lib/describe';
import { formatDuration, formatTime, formatVolume } from '../../lib/format';
import { useHousehold } from '../../lib/household';
import { sideTotals } from '../../lib/nursing';
import { columnBlocks, dayColumns, hourTicks, snap, type Block } from '../../lib/timeline';
import type { EventRow } from '../../lib/types';
import { useChartTheme } from '../charts/theme';

const PREFS_KEY = 'kt.timeline';
const MIN = 60_000;
const MIN_DURATION = 5 * MIN;

const DAY_CHOICES = [1, 2, 3, 4, 5, 6];
export const ZOOM_MIN = 1, ZOOM_MAX = 8;
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
interface Prefs { cutoff: number; diapers: boolean; days: number }
function loadPrefs(): Prefs {
  const def: Prefs = { cutoff: 19, diapers: true, days: 6 };
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return {
      cutoff: Number.isInteger(p.cutoff) ? p.cutoff : def.cutoff,
      diapers: p.diapers ?? def.diapers,
      days: DAY_CHOICES.includes(p.days) ? p.days : def.days,
    };
  } catch { return def; }
}
function savePrefs(p: Prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode: keep in memory */ }
}

const CUTOFFS = [0, 17, 18, 19, 20, 21, 6];
const cutoffLabel = (h: number) => (h === 0 ? 'Midnight' : h === 12 ? 'Noon' : h < 12 ? `${h} am` : `${h - 12} pm`);

interface Drag {
  id: string; mode: 'start' | 'end' | 'move';
  y0: number; s0: number; e0: number | null; // original times (ms); e0 null for instants / running
  s: number; e: number | null;               // preview
  moved: boolean;
}

/**
 * Week timeline: 7 day columns (newest right), time running downward from the
 * per-phone day cutoff. Sleep and feeds are blocks at their real duration;
 * bottles are dots; diapers are ticks on the column edge. Tap a block to select
 * it, then drag its handles (or use ±5 min) to adjust; changes save with Undo.
 */
export default function WeekTimeline({ onEdit }: { onEdit: (e: EventRow) => void }) {
  const data = useData();
  const { settings } = useHousehold();
  const theme = useChartTheme();
  const [toast] = useIonToast();
  const now = useNow(30_000);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;
  // Latest loaded rows, so Undo works from the saved state (incl. shifted nursing segments).
  const eventsRef = useRef(data.events);
  eventsRef.current = data.events;

  const update = (p: Partial<Prefs>) => setPrefs((old) => { const n = { ...old, ...p }; savePrefs(n); return n; });

  // Zoom stretches only the time axis (pinch, or the − / + buttons). 1 = whole day on screen.
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const baseHourPx = Math.min(40, Math.max(18, Math.floor((window.innerHeight - 345) / 24)));
  const colH = Math.round(baseHourPx * 24 * zoom);
  const cols = useMemo(() => dayColumns(now, prefs.cutoff, prefs.days, page), [now, prefs.cutoff, prefs.days, page]);
  const wide = prefs.days <= 3; // room for time labels inside blocks

  // Load older entries when paging back past what is in memory.
  useEffect(() => {
    if (cols[0].start < data.since) void data.loadOlder();
  }, [cols, data.since, data]);

  // Events with the drag preview applied.
  const events = useMemo(() => {
    if (!drag) return data.events;
    return data.events.map((e) => e.id !== drag.id ? e : {
      ...e, started_at: new Date(drag.s).toISOString(),
      ended_at: e.ended_at && drag.e != null ? new Date(drag.e).toISOString() : e.ended_at,
    });
  }, [data.events, drag]);

  const sel = selected ? data.events.find((e) => e.id === selected) ?? null : null;
  useEffect(() => { if (selected && !sel) setSelected(null); }, [selected, sel]);

  // ── Saving with undo ──
  async function commit(e: EventRow, s: number, en: number | null) {
    const prevS = new Date(e.started_at), prevE = e.ended_at ? new Date(e.ended_at) : null;
    if (s === prevS.getTime() && (en == null || en === prevE?.getTime())) return;
    const ok = await data.retime(e, new Date(s), en != null ? new Date(en) : null);
    if (!ok) return;
    void toast({
      message: `${META[e.type].label} moved to ${formatTime(new Date(s))}${en != null ? `–${formatTime(new Date(en))}` : ''}`,
      duration: 5000,
      buttons: [{ text: 'Undo', handler: () => {
        const cur = eventsRef.current.find((x) => x.id === e.id);
        if (cur) void data.retime(cur, prevS, prevE);
      } }],
    });
  }

  // ── Limits for a change ──
  function clamp(e: EventRow, mode: Drag['mode'], s: number, en: number | null): [number, number | null] {
    const nowMs = Date.now();
    const segs = [...(e.nursing_segments ?? [])].sort((a, b) => a.started_at.localeCompare(b.started_at));
    const instant = e.type === 'bottle' || e.type === 'diaper';
    if (instant || mode === 'move') {
      const dur = en != null ? en - s : 0;
      const latest = (en != null ? nowMs - dur : nowMs);
      const s2 = Math.min(s, latest);
      return [s2, en != null ? s2 + dur : null];
    }
    const endRef = en ?? nowMs; // running: end is "now"
    if (mode === 'start') {
      let maxS = endRef - MIN_DURATION;
      if (e.type === 'nursing' && segs[0]?.ended_at) maxS = Math.min(maxS, new Date(segs[0].ended_at).getTime() - MIN);
      return [Math.min(s, maxS), en];
    }
    let minE = s + MIN_DURATION;
    const last = segs[segs.length - 1];
    if (e.type === 'nursing' && last) minE = Math.max(minE, new Date(last.started_at).getTime() + MIN);
    return [s, Math.min(Math.max(en ?? minE, minE), nowMs)];
  }

  // ── Dragging (window listeners so the block may move between columns) ──
  useEffect(() => {
    if (!drag) return;
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current; if (!d) return;
      const e = data.events.find((x) => x.id === d.id); if (!e) return;
      const dy = ev.clientY - d.y0;
      if (!d.moved && Math.abs(dy) < 4) return;
      const dt = (dy / colH) * 86_400_000;
      let s = d.s0, en = d.e0;
      if (d.mode === 'start') s = snap(new Date(d.s0 + dt)).getTime();
      else if (d.mode === 'end' && d.e0 != null) en = snap(new Date(d.e0 + dt)).getTime();
      else { s = snap(new Date(d.s0 + dt)).getTime(); if (d.e0 != null) en = s + (d.e0 - d.s0); }
      [s, en] = clamp(e, d.mode, s, en);
      setDrag({ ...d, s, e: en, moved: true });
      ev.preventDefault();
    };
    const onUp = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d || !d.moved) return;
      const e = data.events.find((x) => x.id === d.id);
      if (e) void commit(e, d.s, d.e);
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.id, drag?.mode, colH, data.events]);

  function startDrag(ev: React.PointerEvent, e: EventRow, mode: Drag['mode']) {
    ev.stopPropagation();
    const s0 = new Date(e.started_at).getTime();
    const e0 = e.ended_at ? new Date(e.ended_at).getTime() : null;
    setDrag({ id: e.id, mode, y0: ev.clientY, s0, e0, s: s0, e: e0, moved: false });
  }

  function nudge(e: EventRow, which: 'start' | 'end', minutes: number) {
    const s = new Date(e.started_at).getTime(), en = e.ended_at ? new Date(e.ended_at).getTime() : null;
    const instant = e.type === 'bottle' || e.type === 'diaper';
    const mode = instant ? 'move' : which;
    const [s2, e2] = clamp(e, mode, which === 'start' ? s + minutes * MIN : s, which === 'end' && en != null ? en + minutes * MIN : en);
    void commit(e, s2, e2);
  }

  const first = cols[0].start, last = cols[cols.length - 1].start;
  const md = (d: Date) => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const rangeLabel = cols.length === 1
    ? first.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
    : `${md(first)} – ${md(last)}`;
  // Denser labels and gridlines as the time axis stretches.
  const hourPxNow = colH / 24;
  const ticks = hourTicks(prefs.cutoff, hourPxNow >= 60 ? 1 : hourPxNow >= 36 ? 2 : 3);
  const gridTicks = hourTicks(prefs.cutoff, hourPxNow >= 30 ? 1 : 3);

  // Change zoom while keeping the time at screen position `anchorY` (client px) in place.
  // Uses only the rendered layout, so rapid pinch updates before a re-render don't drift.
  const scrollerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const contentEl = gridRef.current?.closest('ion-content') as (HTMLElement & { getScrollElement?: () => Promise<HTMLElement> }) | null;
    void contentEl?.getScrollElement?.().then((el) => { scrollerRef.current = el; });
  }, []);
  function zoomTo(next: number, anchorY?: number) {
    const z = clampZoom(next);
    const grid = gridRef.current, scroller = scrollerRef.current;
    if (Math.abs(z - zoomRef.current) < 0.001 || !grid) return;
    const rect = grid.getBoundingClientRect();
    const sRect = scroller?.getBoundingClientRect();
    const y = anchorY ?? (sRect ? sRect.top + sRect.height / 2 : rect.top);
    const frac = Math.min(1, Math.max(0, (y - rect.top) / rect.height)); // time fraction under the anchor
    zoomRef.current = z;
    setZoom(z);
    if (scroller && sRect) {
      const gridTopInContent = rect.top - sRect.top + scroller.scrollTop;
      const target = Math.round(baseHourPx * 24 * z);
      const desired = gridTopInContent + frac * target - (y - sRect.top);
      requestAnimationFrame(() => { scroller.scrollTop = Math.max(0, desired); });
    }
  }

  // Two-finger pinch on the grid → zoom the time axis (single-finger scrolling is untouched).
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    let start: { dist: number; zoom: number } | null = null;
    const span = (t: TouchList) => Math.max(20, Math.abs(t[0].clientY - t[1].clientY));
    const mid = (t: TouchList) => (t[0].clientY + t[1].clientY) / 2;
    let selectedBefore: string | null = null;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 1) selectedBefore = selectedRef.current;
      if (e.touches.length === 2) {
        // A pinch is not a tap or a drag: undo whatever the first finger started.
        dragRef.current = null;
        setDrag(null);
        setSelected(selectedBefore);
        start = { dist: span(e.touches), zoom: zoomRef.current };
        e.preventDefault();
      }
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      zoomTo(start.zoom * (span(e.touches) / start.dist), mid(e.touches));
    };
    const onEnd = (e: TouchEvent) => { if (e.touches.length < 2) start = null; };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const color = { sleep: theme.series[0], feed: theme.series[1] };

  return (
    <div className="tl" onPointerDown={() => !drag && setSelected(null)}>
      <div className="tl-toolbar">
        <IonButton fill="clear" size="small" aria-label="Earlier" onClick={() => { setPage(page + 1); setSelected(null); }}>
          <IonIcon slot="icon-only" icon={chevronBack} />
        </IonButton>
        <span className="tl-range">{rangeLabel}</span>
        <IonButton fill="clear" size="small" aria-label="Later" disabled={page === 0} onClick={() => { setPage(page - 1); setSelected(null); }}>
          <IonIcon slot="icon-only" icon={chevronForward} />
        </IonButton>
        <IonSelect className="tl-cutoff" aria-label="Day starts at" interface="popover" value={prefs.cutoff}
          onIonChange={(e) => update({ cutoff: Number(e.detail.value) })}>
          {CUTOFFS.map((h) => <IonSelectOption key={h} value={h}>Day starts {cutoffLabel(h)}</IonSelectOption>)}
        </IonSelect>
      </div>

      <div className="tl-days">
        <span>Days</span>
        <IonSegment value={String(prefs.days)} onIonChange={(e) => { update({ days: Number(e.detail.value) }); setPage(0); setSelected(null); }}>
          {DAY_CHOICES.map((n) => <IonSegmentButton key={n} value={String(n)}>{n}</IonSegmentButton>)}
        </IonSegment>
      </div>

      <div className="tl-legend">
        <span><i style={{ background: color.sleep }} />Sleep</span>
        <span><i style={{ background: color.feed }} />Nursing</span>
        <span><i className="dot" style={{ background: color.feed }} />Bottle</span>
        <button className={`tl-toggle ${prefs.diapers ? 'on' : ''}`} onClick={() => update({ diapers: !prefs.diapers })}>
          <i className="tick" style={{ background: theme.muted }} />Diapers {prefs.diapers ? 'on' : 'off'}
        </button>
        <span className="tl-zoom">
          <IonButton fill="clear" size="small" aria-label="Zoom out" disabled={zoom <= ZOOM_MIN} onClick={() => zoomTo(zoom / 1.5)}>
            <IonIcon slot="icon-only" icon={remove} />
          </IonButton>
          <button className="tl-zoom-label" onClick={() => zoomTo(1)} aria-label="Reset zoom">{zoom > 1.01 ? `${Math.round(zoom * 10) / 10}×` : '1×'}</button>
          <IonButton fill="clear" size="small" aria-label="Zoom in" disabled={zoom >= ZOOM_MAX} onClick={() => zoomTo(zoom * 1.5)}>
            <IonIcon slot="icon-only" icon={add} />
          </IonButton>
        </span>
      </div>

      <div className="tl-head">
        <div className="tl-axis-pad" />
        {cols.map((c) => (
          <div key={c.start.getTime()} className="tl-colhead">
            <b>{c.start.toLocaleDateString([], { weekday: wide ? 'long' : 'short' })}{prefs.cutoff !== 0 ? ' →' : ''}</b>
            <span>{wide ? md(c.start) : `${c.start.getMonth() + 1}/${c.start.getDate()}`}</span>
          </div>
        ))}
      </div>

      <div className="tl-body" style={{ height: colH }} ref={gridRef} data-zoom={zoom}>
        <div className="tl-axis">
          {ticks.map((t) => (
            <span key={t.frac} style={{ top: t.frac * colH }}>{t.label}</span>
          ))}
        </div>
        {cols.map((c) => {
          const blocks = columnBlocks(events, c, now, 3 / colH);
          const nowIn = now >= c.start && now < c.end;
          return (
            <div key={c.start.getTime()} className="tl-col" style={{ borderColor: theme.grid }}>
              {gridTicks.map((t) => <div key={t.frac} className="tl-grid" style={{ top: t.frac * colH, background: theme.grid }} />)}
              {blocks.filter((b) => prefs.diapers || b.kind !== 'diaper').map((b) => (
                <BlockView key={b.event.id + c.start.getTime()} b={b} colH={colH} color={color} theme={theme} wide={wide}
                  selected={b.event.id === selected} dragging={drag?.id === b.event.id}
                  onSelect={() => setSelected(b.event.id)}
                  onDrag={(ev, mode) => startDrag(ev, b.event, mode)} />
              ))}
              {nowIn && (
                <div className="tl-now" style={{ top: ((now.getTime() - c.start.getTime()) / (c.end.getTime() - c.start.getTime())) * colH, background: theme.text }} />
              )}
            </div>
          );
        })}
      </div>

      {drag?.moved && (
        <div className="tl-dragtip">
          {formatTime(new Date(drag.s))}{drag.e != null ? ` – ${formatTime(new Date(drag.e))} (${formatDuration(drag.e - drag.s)})` : ''}
        </div>
      )}

      {sel && !drag && (
        <DetailCard e={sel} names={data.names} settings={settings} onClose={() => setSelected(null)}
          onNudge={(which, m) => nudge(sel, which, m)} onEdit={() => onEdit(sel)} />
      )}
    </div>
  );
}

function BlockView({ b, colH, color, theme, wide, selected, dragging, onSelect, onDrag }: {
  b: Block; colH: number; color: { sleep: string; feed: string }; theme: ReturnType<typeof useChartTheme>; wide: boolean;
  selected: boolean; dragging: boolean;
  onSelect: () => void; onDrag: (ev: React.PointerEvent, mode: Drag['mode']) => void;
}) {
  const top = b.top * colH;
  const instant = b.kind === 'bottle' || b.kind === 'diaper';
  const h = instant ? 0 : Math.max(3, (b.bottom - b.top) * colH);
  const segs = b.event.nursing_segments ?? [];
  const t = b.kind === 'nursing' ? sideTotals(segs) : null;
  const sides = t ? (t.left && t.right ? 'LR' : t.left ? 'L' : t.right ? 'R' : '') : '';
  const sEnd = b.event.ended_at ? new Date(b.event.ended_at) : null;
  const dur = sEnd ? formatDuration(sEnd.getTime() - new Date(b.event.started_at).getTime()) : '';
  // Narrow columns: just L/R on feeds. Wide columns (1–3 days): start time and length too.
  const start = formatTime(new Date(b.event.started_at));
  const label = wide && h >= 16 && !b.clippedTop
    ? [start, dur, sides].filter(Boolean).join(' · ')
    : h >= 30 && !b.clippedTop // narrow columns, zoomed in: start time (and side) on two lines
      ? [start.replace(/\s?[AP]M$/i, ''), sides].filter(Boolean).join('\n')
      : b.kind === 'nursing' && h >= 14 ? sides : '';

  const select = (ev: React.PointerEvent) => {
    ev.stopPropagation();
    if (selected) onDrag(ev, 'move'); else onSelect();
  };
  const ring = `0 0 0 2px ${theme.surface}`;
  const outline = selected ? `0 0 0 2px ${theme.surface}, 0 0 0 4px ${theme.text}` : ring;

  if (b.kind === 'diaper') {
    return (
      <div className={`tl-diaper ${selected ? 'sel' : ''}`} style={{ top: top - 8 }} onPointerDown={select}
        role="button" aria-label={`Diaper ${formatTime(new Date(b.event.started_at))}`}>
        <i style={{ background: theme.muted, boxShadow: selected ? `0 0 0 2px ${theme.text}` : undefined }} />
      </div>
    );
  }
  if (b.kind === 'bottle') {
    return (
      <div className="tl-bottle" style={{ top: top - 12 }} onPointerDown={select}
        role="button" aria-label={`Bottle ${formatTime(new Date(b.event.started_at))}`}>
        <i style={{ background: color.feed, boxShadow: outline }} />
      </div>
    );
  }
  const bg = b.kind === 'sleep' ? color.sleep : color.feed;
  return (
    <div className={`tl-block ${b.narrow ? 'narrow' : ''} ${dragging ? 'dragging' : ''}`}
      style={{
        top, height: h, background: bg, boxShadow: outline,
        borderTopLeftRadius: b.clippedTop ? 0 : 4, borderTopRightRadius: b.clippedTop ? 0 : 4,
        borderBottomLeftRadius: b.clippedBottom ? 0 : 4, borderBottomRightRadius: b.clippedBottom ? 0 : 4,
        touchAction: selected ? 'none' : undefined,
      }}
      onPointerDown={select} role="button"
      aria-label={`${META[b.event.type].label} ${formatTime(new Date(b.event.started_at))}`}>
      {label && <span className="tl-side">{label}</span>}
      {selected && !b.clippedTop && (
        <span className="tl-handle top" onPointerDown={(ev) => onDrag(ev, 'start')} style={{ background: theme.text }} />
      )}
      {selected && !b.clippedBottom && !b.running && (
        <span className="tl-handle bottom" onPointerDown={(ev) => onDrag(ev, 'end')} style={{ background: theme.text }} />
      )}
    </div>
  );
}

function DetailCard({ e, names, settings, onClose, onNudge, onEdit }: {
  e: EventRow; names: Record<string, string>; settings: ReturnType<typeof useHousehold>['settings'];
  onClose: () => void; onNudge: (which: 'start' | 'end', minutes: number) => void; onEdit: () => void;
}) {
  const s = new Date(e.started_at), en = e.ended_at ? new Date(e.ended_at) : null;
  const instant = e.type === 'bottle' || e.type === 'diaper';
  const t = e.type === 'nursing' ? sideTotals(e.nursing_segments ?? []) : null;
  const detail = [
    instant ? formatTime(s) : `${formatTime(s)} – ${en ? formatTime(en) : 'now'}${en ? ` (${formatDuration(en.getTime() - s.getTime())})` : ''}`,
    t && [t.left ? `L ${formatDuration(t.left)}` : '', t.right ? `R ${formatDuration(t.right)}` : ''].filter(Boolean).join(' '),
    e.type === 'bottle' && formatVolume(e.bottle_ml, settings),
    e.type === 'diaper' && [e.diaper_wet && 'wet', e.diaper_dirty && 'dirty'].filter(Boolean).join(' + '),
    e.created_by && names[e.created_by] ? `by ${names[e.created_by]}` : '',
  ].filter(Boolean).join(' · ');
  const stop = (ev: React.PointerEvent) => ev.stopPropagation();
  return (
    <div className="tl-card" onPointerDown={stop}>
      <div className="tl-card-head">
        <b>{META[e.type].emoji} {META[e.type].label}</b>
        <IonButton fill="clear" size="small" aria-label="Close" onClick={onClose}><IonIcon slot="icon-only" icon={close} /></IonButton>
      </div>
      <div className="tl-card-detail">{detail}</div>
      <div className="tl-card-actions">
        <span>{instant ? 'Time' : 'Start'}</span>
        <IonButton size="small" fill="outline" onClick={() => onNudge('start', -5)}>−5</IonButton>
        <IonButton size="small" fill="outline" onClick={() => onNudge('start', 5)}>+5</IonButton>
        {!instant && en && (
          <>
            <span>End</span>
            <IonButton size="small" fill="outline" onClick={() => onNudge('end', -5)}>−5</IonButton>
            <IonButton size="small" fill="outline" onClick={() => onNudge('end', 5)}>+5</IonButton>
          </>
        )}
        <IonButton size="small" onClick={onEdit}>Edit</IonButton>
      </div>
      <div className="tl-card-hint">{instant ? 'Drag the mark to move it.' : 'Drag the block or its handles to adjust.'}</div>
    </div>
  );
}
