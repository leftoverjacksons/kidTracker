import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { conflictsFor, isNow, type Action } from './conflicts';
import { useHousehold } from './household';
import { supabase } from './supabase';
import type { EventFields, EventRow, EventType, Medication, TimedType } from './types';

/** How far back the app keeps entries in memory (History can load more). */
const WINDOW_DAYS = 30;

interface Data {
  ready: boolean;
  /** Non-deleted events, newest first. */
  events: EventRow[];
  running: Partial<Record<TimedType, EventRow>>;
  /** Optional database features (public.app_features(); empty before those migrations). */
  features: { bottleTimer: boolean };
  latest: Partial<Record<EventType, EventRow>>;
  meds: Medication[];
  names: Record<string, string>;
  reload: () => Promise<void>;
  loadOlder: () => Promise<boolean>;
  /** Earliest time currently loaded. */
  since: Date;
  /** Change an entry's start/end (keeps nursing side segments consistent). Pass end = null for instants or running timers. */
  retime: (e: EventRow, start: Date, end: Date | null) => Promise<boolean>;
  add: (type: EventType, fields: EventFields) => Promise<EventRow | null>;
  update: (id: string, fields: EventFields) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  restore: (id: string) => Promise<boolean>;
  startTimer: (type: TimedType, at?: Date, extra?: { pump_side?: string }) => Promise<EventRow | null>;
  stopTimer: (id: string, at?: Date) => Promise<boolean>;
  setNursingSide: (eventId: string, side: 'left' | 'right' | null, at?: Date) => Promise<boolean>;
  addManualNursing: (start: Date, segs: { side: 'left' | 'right'; started_at: Date; ended_at: Date }[], notes: string | null) => Promise<boolean>;
  replaceNursingSegments: (eventId: string, segs: { side: 'left' | 'right'; started_at: Date; ended_at: Date }[]) => Promise<boolean>;
  saveMedication: (m: Partial<Medication> & { name: string }) => Promise<boolean>;
  /** End running timers that conflict with `action` done at `at` (design doc §8a E1). Returns what was ended. */
  autoStop: (action: Action, at?: Date) => Promise<EventRow[]>;
  /** Undo for autoStop: reopen those timers (and the nursing side that was active). */
  reopen: (stopped: EventRow[]) => Promise<void>;
}

const Ctx = createContext<Data | null>(null);

export function DataProvider({ children, onError }: { children: ReactNode; onError: (msg: string) => void }) {
  const { baby } = useHousehold();
  const babyId = baby?.id;
  const [events, setEvents] = useState<EventRow[]>([]);
  const [meds, setMeds] = useState<Medication[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [features, setFeatures] = useState<Data['features']>({ bottleTimer: false });
  useEffect(() => {
    if (!supabase || !babyId) return;
    void supabase.rpc('app_features').then(({ data }) => setFeatures({ bottleTimer: Array.isArray(data) && data.includes('bottle_timer') }));
  }, [babyId]);
  const [ready, setReady] = useState(false);
  const since = useRef(new Date(Date.now() - WINDOW_DAYS * 86_400_000));
  const err = useRef(onError);
  err.current = onError;

  const fail = (e: { message: string } | null) => {
    if (e) err.current(e.message);
    return !e;
  };

  const reload = useCallback(async () => {
    if (!supabase || !babyId) return;
    const sinceIso = since.current.toISOString();
    const [ev, running, md, cg] = await Promise.all([
      supabase.from('events').select('*, nursing_segments(*)')
        .eq('baby_id', babyId).is('deleted_at', null).gte('started_at', sinceIso)
        .order('started_at', { ascending: false }),
      // Timers started before the window (unlikely) still need to show.
      supabase.from('events').select('*, nursing_segments(*)')
        .eq('baby_id', babyId).is('deleted_at', null).is('ended_at', null).lt('started_at', sinceIso),
      supabase.from('medications').select('*').order('name'),
      supabase.from('caregivers').select('id, display_name'),
    ]);
    if (ev.error) return void err.current(ev.error.message);
    setEvents([...(running.data ?? []), ...(ev.data ?? [])] as EventRow[]);
    setMeds((md.data ?? []) as Medication[]);
    setNames(Object.fromEntries((cg.data ?? []).map((c) => [c.id, c.display_name])));
    setReady(true);
  }, [babyId]);

  // Initial load, live updates from the other phone, and refresh on wake.
  useEffect(() => {
    if (!supabase || !babyId) return;
    const client = supabase;
    void reload();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(timer); timer = setTimeout(() => void reload(), 250); };
    const channel = client.channel('events')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'nursing_segments' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'medications' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'caregivers' }, soon)
      .subscribe();
    const onVisible = () => document.visibilityState === 'visible' && soon();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', soon);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', soon);
      void client.removeChannel(channel);
    };
  }, [babyId, reload]);

  const loadOlder = useCallback(async () => {
    const before = since.current;
    since.current = new Date(before.getTime() - WINDOW_DAYS * 86_400_000);
    await reload();
    return true;
  }, [reload]);

  const value = useMemo<Data>(() => {
    const running: Data['running'] = {};
    const latest: Data['latest'] = {};
    for (const e of events) {
      // Before migration 0007, bottles had no end time without being timers.
      if (!e.ended_at && (e.type === 'sleep' || e.type === 'nursing' || e.type === 'pump' || e.type === 'tummy_time' || (e.type === 'bottle' && features.bottleTimer))) {
        running[e.type] = e;
      }
      if (!latest[e.type]) latest[e.type] = e; // events are newest first
    }
    const client = supabase!;

    const add: Data['add'] = async (type, fields) => {
      const { data, error } = await client.from('events')
        .insert({ id: crypto.randomUUID(), baby_id: babyId, type, started_at: new Date().toISOString(), ...fields })
        .select().single();
      fail(error);
      await reload();
      return (data as EventRow) ?? null;
    };
    const update: Data['update'] = async (id, fields) => {
      const ok = fail((await client.from('events').update(fields).eq('id', id)).error);
      await reload();
      return ok;
    };
    const remove: Data['remove'] = (id) => update(id, { deleted_at: new Date().toISOString() });
    const restore: Data['restore'] = (id) => update(id, { deleted_at: null });

    const startTimer: Data['startTimer'] = async (type, at = new Date(), extra = {}) => {
      const { data, error } = await client.rpc('start_timer', {
        p_id: crypto.randomUUID(), p_baby_id: babyId, p_type: type,
        p_started_at: at.toISOString(), p_pump_side: extra.pump_side ?? null,
      });
      fail(error);
      await reload();
      return (data as EventRow) ?? null;
    };
    const stopTimer: Data['stopTimer'] = async (id, at = new Date()) => {
      const ok = fail((await client.rpc('stop_timer', { p_id: id, p_ended_at: at.toISOString() })).error);
      await reload();
      return ok;
    };
    const setNursingSide: Data['setNursingSide'] = async (eventId, side, at = new Date()) => {
      const ok = fail((await client.rpc('nursing_set_side', {
        p_event_id: eventId, p_side: side, p_at: at.toISOString(),
      })).error);
      await reload();
      return ok;
    };
    const addManualNursing: Data['addManualNursing'] = async (start, segs, notes) => {
      const id = crypto.randomUUID();
      const end = segs.length ? segs[segs.length - 1].ended_at : start;
      const ev = await client.from('events').insert({
        id, baby_id: babyId, type: 'nursing', started_at: start.toISOString(), ended_at: end.toISOString(), notes,
      });
      let ok = fail(ev.error);
      if (ok && segs.length) {
        ok = fail((await client.from('nursing_segments').insert(segs.map((s) => ({
          event_id: id, side: s.side, started_at: s.started_at.toISOString(), ended_at: s.ended_at.toISOString(),
        })))).error);
      }
      await reload();
      return ok;
    };
    const retime: Data['retime'] = async (e, start, end) => {
      const fields: EventFields = { started_at: start.toISOString() };
      if (end && e.ended_at) fields.ended_at = end.toISOString();
      let ok = fail((await client.from('events').update(fields).eq('id', e.id)).error);
      const segs = [...(e.nursing_segments ?? [])].sort((a, b) => a.started_at.localeCompare(b.started_at));
      if (ok && e.type === 'nursing' && segs.length) {
        const oldStart = new Date(e.started_at).getTime();
        const oldEnd = e.ended_at ? new Date(e.ended_at).getTime() : null;
        const ds = start.getTime() - oldStart;
        const de = end && oldEnd != null ? end.getTime() - oldEnd : 0;
        const moved = ds !== 0 && (oldEnd == null || ds === de);
        const iso = (t: string | null, d: number) => (t ? new Date(new Date(t).getTime() + d).toISOString() : null);
        const updates: { id: string; started_at?: string; ended_at?: string | null }[] = [];
        if (moved) {
          for (const g of segs) updates.push({ id: g.id, started_at: iso(g.started_at, ds)!, ended_at: iso(g.ended_at, ds) });
        } else {
          if (ds !== 0) updates.push({ id: segs[0].id, started_at: start.toISOString() });
          const last = segs[segs.length - 1];
          if (de !== 0 && last.ended_at) updates.push({ id: last.id, ended_at: end!.toISOString() });
        }
        for (const u of updates) {
          const { id, ...f } = u;
          ok = fail((await client.from('nursing_segments').update(f).eq('id', id)).error) && ok;
        }
      }
      await reload();
      return ok;
    };
    const replaceNursingSegments: Data['replaceNursingSegments'] = async (eventId, segs) => {
      let ok = fail((await client.from('nursing_segments').delete().eq('event_id', eventId)).error);
      if (ok && segs.length) {
        ok = fail((await client.from('nursing_segments').insert(segs.map((x) => ({
          event_id: eventId, side: x.side, started_at: x.started_at.toISOString(), ended_at: x.ended_at.toISOString(),
        })))).error);
      }
      await reload();
      return ok;
    };
    const autoStop: Data['autoStop'] = async (action, at = new Date()) => {
      if (!isNow(at)) return [];
      const conflicts = conflictsFor(action, events.filter((e) => !e.ended_at));
      const stopped: EventRow[] = [];
      for (const e of conflicts) {
        // Never end a timer before it started.
        const end = new Date(Math.max(at.getTime(), new Date(e.started_at).getTime() + 1000));
        const { error } = await client.rpc('stop_timer', { p_id: e.id, p_ended_at: end.toISOString() });
        if (fail(error)) stopped.push(e);
      }
      if (stopped.length) await reload();
      return stopped;
    };
    const reopen: Data['reopen'] = async (stopped) => {
      for (const e of stopped) {
        let ok = fail((await client.from('events').update({ ended_at: null }).eq('id', e.id)).error);
        const open = (e.nursing_segments ?? []).find((g) => !g.ended_at);
        if (ok && open) ok = fail((await client.from('nursing_segments').update({ ended_at: null }).eq('id', open.id)).error);
      }
      await reload();
    };
    const saveMedication: Data['saveMedication'] = async (m) => {
      const ok = fail((await client.from('medications').upsert(m)).error);
      await reload();
      return ok;
    };

    return {
      ready, events, running, features, latest, meds, names, reload, loadOlder, since: since.current, retime,
      add, update, remove, restore, startTimer, stopTimer, setNursingSide, addManualNursing, replaceNursingSegments, saveMedication, autoStop, reopen,
    };
  }, [events, meds, names, ready, babyId, reload, loadOlder, features]); // since.current changes only via loadOlder → reload → events

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): Data {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData outside DataProvider');
  return v;
}

/** Re-renders every `ms` so live timers and "x ago" labels stay current. */
export function useNow(ms = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
