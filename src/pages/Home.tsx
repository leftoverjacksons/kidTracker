import { IonContent, IonHeader, IonPage, IonRefresher, IonRefresherContent, IonSpinner, IonTitle, IonToolbar } from '@ionic/react';
import { useEffect, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import EditSheet from '../components/EditSheet';
import EventList from '../components/EventList';
import LogSheet from '../components/LogSheet';
import { useData, useNow } from '../lib/data';
import { diaperLabel, META } from '../lib/describe';
import { formatAgo, formatClock, formatDuration, formatTemp, formatVolume, formatWeight, startOfDay } from '../lib/format';
import { useHousehold } from '../lib/household';
import { activeSide, countFeeds, lastFeedStart, lastSide, sideTotals } from '../lib/nursing';
import type { EventRow, EventType } from '../lib/types';
import { ageLabel } from '../lib/units';
import PumpGauge from '../components/PumpGauge';
import StillRunning from '../components/StillRunning';
import { pumpCounts } from '../lib/pump';
import TypeIcon from '../components/TypeIcon';

const PRIMARY: EventType[] = ['sleep', 'nursing', 'bottle', 'diaper', 'pump', 'growth'];
const SECONDARY: EventType[] = ['medicine', 'temperature', 'tummy_time', 'bath'];
const SIDE = { left: 'L', right: 'R' } as const;

export default function Home() {
  const { baby, settings } = useHousehold();
  const data = useData();
  const now = useNow();
  const [open, setOpen] = useState<EventType | null>(null);
  const [editing, setEditing] = useState<EventRow | null>(null);
  // Rarely used tiles live under "More" (design doc §8a E2); open/closed is remembered per phone.
  const [moreOpen, setMoreOpen] = useState(() => { try { return localStorage.getItem('kt.homeMore') === '1'; } catch { return false; } });
  const toggleMore = () => setMoreOpen((o) => { try { localStorage.setItem('kt.homeMore', o ? '0' : '1'); } catch { /* ignore */ } return !o; });
  const location = useLocation();
  const history = useHistory();

  // Home-screen shortcuts open a logging sheet directly: #/home?log=diaper
  useEffect(() => {
    const log = new URLSearchParams(location.search).get('log') as EventType | null;
    if (log && log in META && data.ready) {
      setOpen(log);
      history.replace('/home');
    }
  }, [location.search, data.ready, history]);

  const ago = (e?: EventRow) => (e ? formatAgo(new Date(e.ended_at ?? e.started_at), now) : '—');
  const elapsed = (e: EventRow) => formatClock(now.getTime() - new Date(e.started_at).getTime());
  const today = data.events.filter((e) => new Date(e.started_at) >= startOfDay(now));

  function sub(t: EventType): { text: string; live: boolean } {
    const run = (data.running as Partial<Record<EventType, EventRow>>)[t];
    const last = data.latest[t];
    switch (t) {
      case 'sleep':
        if (run) return { text: `Asleep ${elapsed(run)}`, live: true };
        return { text: last?.ended_at ? `Awake ${formatDuration(now.getTime() - new Date(last.ended_at).getTime())}` : '—', live: false };
      case 'nursing': {
        if (run) {
          const segs = run.nursing_segments ?? [];
          const side = activeSide(segs);
          const t2 = sideTotals(segs, now);
          return { text: `${side ? SIDE[side] : 'Paused'} · ${formatClock(t2.left + t2.right)}`, live: true };
        }
        // Time since the START of the last feed (back-to-back entries < 20 min apart count as one).
        const feedStart = lastFeedStart(data.events);
        const ls = last ? lastSide(last.nursing_segments ?? []) : null;
        return { text: feedStart ? `${formatAgo(feedStart, now)}${ls ? ` · last ${SIDE[ls]}` : ''}` : '—', live: false };
      }
      case 'pump':
        if (run) return { text: `Pumping ${elapsed(run)}`, live: true };
        return { text: last ? `${ago(last)}${last.pump_left_ml || last.pump_right_ml ? ` · ${formatVolume((last.pump_left_ml ?? 0) + (last.pump_right_ml ?? 0), settings)}` : ''}` : '—', live: false };
      case 'tummy_time': {
        if (run) return { text: elapsed(run), live: true };
        const ms = today.filter((e) => e.type === 'tummy_time' && e.ended_at)
          .reduce((a, e) => a + new Date(e.ended_at!).getTime() - new Date(e.started_at).getTime(), 0);
        return { text: ms ? `${formatDuration(ms)} today` : '—', live: false };
      }
      case 'bottle': return { text: last ? `${ago(last)} · ${formatVolume(last.bottle_ml, settings)}` : '—', live: false };
      case 'diaper': return { text: last ? `${ago(last)} · ${diaperLabel(last)}` : '—', live: false };
      case 'medicine': {
        const med = last && data.meds.find((m) => m.id === last.medication_id);
        return { text: last ? `${ago(last)}${med ? ` · ${med.name}` : ''}` : '—', live: false };
      }
      case 'temperature': return { text: last ? formatTemp(last.temp_c, settings) : '—', live: false };
      case 'growth': {
        // Latest weight (from the newest entry that has one) and how long ago it was measured.
        const w = data.events.find((e) => e.type === 'growth' && e.weight_g);
        return { text: w ? `${formatWeight(w.weight_g, settings)} · ${ago(w)}` : last ? ago(last) : '—', live: false };
      }
      case 'bath': return { text: ago(last), live: false };
      default: return { text: '—', live: false };
    }
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>
            {baby?.name}
            {baby?.birth_date && <span className="subtitle"> · {ageLabel(baby.birth_date)}</span>}
          </IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonRefresher slot="fixed" onIonRefresh={async (e) => { await data.reload(); e.detail.complete(); }}>
          <IonRefresherContent />
        </IonRefresher>
        {!data.ready ? <div className="centered"><IonSpinner /></div> : (
          <>
            <StillRunning />
            <div className="tile-grid">
              {PRIMARY.map((t) => {
                const s = sub(t);
                const pc = t === 'pump' ? pumpCounts(data.events, now) : null;
                return (
                  <button key={t} data-type={t} className={`tile ${s.live ? 'tile-live' : ''} ${pc ? 'tile-pump' : ''}`} onClick={() => setOpen(t)}>
                    {pc ? (
                      <span className="pump-gauges" title="Pump sessions of 15+ min, last 24 h (target 8–12 per side)">
                        <PumpGauge side="L" count={pc.left} />
                        <PumpGauge side="R" count={pc.right} />
                      </span>
                    ) : <span className="tile-emoji"><TypeIcon type={t} /></span>}
                    <span className="tile-label">{META[t].label}</span>
                    <span className="tile-sub">{s.live && <span className="live-dot" />}{s.text}</span>
                  </button>
                );
              })}
            </div>
            {(() => {
              const secondaryLive = SECONDARY.some((t) => sub(t).live);
              const show = moreOpen || secondaryLive;
              return (
                <>
                  <button className="more-toggle" onClick={toggleMore} aria-expanded={show}>
                    <span>{show ? 'Less' : 'More'}</span>
                    <span className="more-hint">{SECONDARY.map((t) => <TypeIcon key={t} type={t} />)}</span>
                    <span className="more-chevron">{show ? '▴' : '▾'}</span>
                  </button>
                  {show && (
            <div className="tile-grid tile-grid-small">
              {SECONDARY.map((t) => {
                const s = sub(t);
                return (
                  <button key={t} data-type={t} className={`tile tile-small ${s.live ? 'tile-live' : ''}`} onClick={() => setOpen(t)}>
                    <span className="tile-emoji"><TypeIcon type={t} /></span>
                    <span className="tile-label">{t === 'tummy_time' ? 'Tummy' : META[t].label}</span>
                    <span className="tile-sub tile-sub-small">{s.text}</span>
                  </button>
                );
              })}
            </div>
                  )}
                </>
              );
            })()}
            <TodaySummary events={today} feeds={countFeeds(data.events, startOfDay(now))} />
            {today.length === 0
              ? <p className="empty">Nothing logged today.</p>
              : <EventList events={today} onOpen={setEditing} groupByDay={false} />}
          </>
        )}
        <LogSheet type={open} onClose={() => setOpen(null)} />
        <EditSheet event={editing} onClose={() => setEditing(null)} />
      </IonContent>
    </IonPage>
  );
}

function TodaySummary({ events, feeds }: { events: EventRow[]; feeds: number }) {
  const { settings } = useHousehold();
  const now = useNow(60_000);
  let sleepMs = 0, bottleMl = 0, wet = 0, dirty = 0;
  const dayStart = startOfDay(now).getTime();
  for (const e of events) {
    if (e.type === 'sleep') {
      const end = e.ended_at ? new Date(e.ended_at).getTime() : now.getTime();
      sleepMs += end - Math.max(dayStart, new Date(e.started_at).getTime());
    }
    if (e.type === 'bottle') bottleMl += e.bottle_ml ?? 0;
    if (e.type === 'diaper') { if (e.diaper_wet) wet++; if (e.diaper_dirty) dirty++; }
  }
  return (
    <div className="summary">
      <h2 className="section-title">Today</h2>
      <div className="summary-row">
        <div><b>{formatDuration(sleepMs)}</b><span>sleep</span></div>
        <div><b>{feeds}</b><span>feeds</span></div>
        <div><b>{bottleMl ? formatVolume(bottleMl, settings) : '0'}</b><span>bottle</span></div>
        <div><b>{wet}/{dirty}</b><span>wet/dirty</span></div>
      </div>
    </div>
  );
}
