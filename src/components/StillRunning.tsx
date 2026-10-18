import { IonButton, useIonToast } from '@ionic/react';
import { useState } from 'react';
import { useData, useNow } from '../lib/data';
import { formatDuration } from '../lib/format';
import { useHousehold } from '../lib/household';
import { loadSnoozes, overdue, snooze, type Snoozes } from '../lib/longRunning';
import type { EventRow, TimedType } from '../lib/types';
import TimeField from './TimeField';

const QUESTION: Record<TimedType, [string, string]> = {
  sleep: ['Sleep', 'Still asleep?'],
  nursing: ['Nursing', 'Still nursing?'],
  pump: ['Pumping', 'Still pumping?'],
  tummy_time: ['Tummy time', 'Still going?'],
};

/** "Sleep has been running 5h 10m — still asleep?" for timers past their threshold (design doc §8a E5). */
export default function StillRunning({ only }: { only?: TimedType }) {
  const data = useData();
  const now = useNow(30_000);
  const [snoozes, setSnoozes] = useState<Snoozes>(loadSnoozes);
  const list = overdue(data.running, now, snoozes).filter((e) => !only || e.type === only);
  if (!list.length) return null;
  const ids = (Object.values(data.running) as EventRow[]).map((e) => e.id);
  return (
    <div className="still-running-list">
      {list.map((e) => (
        <Card key={e.id} e={e} now={now} onSnooze={() => setSnoozes((s) => snooze(s, e, new Date(), ids))} />
      ))}
    </div>
  );
}

function Card({ e, now, onSnooze }: { e: EventRow; now: Date; onSnooze: () => void }) {
  const data = useData();
  const { me } = useHousehold();
  const [toast] = useIonToast();
  const [ending, setEnding] = useState(false);
  const start = new Date(e.started_at);
  const [end, setEnd] = useState<Date | null>(null);
  const [label, q] = QUESTION[e.type as TimedType];
  const who = e.created_by && e.created_by === me?.id ? 'you'
    : e.created_by ? data.names[e.created_by] ?? null : null;
  const valid = end != null && end > start && end <= new Date();

  const finish = async () => {
    if (!end || !valid) return;
    if (await data.stopTimer(e.id, end)) {
      void toast({ message: `${label} ended at ${end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, duration: 5000,
        buttons: [{ text: 'Undo', handler: () => { void data.reopen([e]); } }] });
    }
  };
  const discard = async () => {
    if (!window.confirm(`Delete this ${label.toLowerCase()} entry?`)) return;
    if (await data.remove(e.id)) {
      void toast({ message: `${label} deleted`, duration: 5000, buttons: [{ text: 'Undo', handler: () => { void data.restore(e.id); } }] });
    }
  };

  return (
    <div className="still-running" data-type={e.type} style={{ ['--acc' as string]: `var(--acc-${e.type})` }}>
      <p className="still-running-q">
        <b>{label} has been running {formatDuration(now.getTime() - start.getTime())}.</b> {q}
      </p>
      <p className="still-running-who">
        Started {start.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}{who ? ` by ${who}` : ''}
      </p>
      {ending ? (
        <>
          <TimeField label="It ended at" value={end} onChange={setEnd} />
          {end && !valid && <p className="still-running-err">Pick a time after it started and not in the future.</p>}
          <div className="still-running-actions">
            <IonButton size="small" disabled={!valid} onClick={() => void finish()}>Save end time</IonButton>
            <IonButton size="small" fill="clear" onClick={() => setEnding(false)}>Cancel</IonButton>
          </div>
        </>
      ) : (
        <div className="still-running-actions">
          <IonButton size="small" onClick={onSnooze}>Yes, still going</IonButton>
          <IonButton size="small" fill="outline" onClick={() => { setEnd(null); setEnding(true); }}>It ended at…</IonButton>
          <IonButton size="small" fill="clear" color="medium" onClick={() => void discard()}>Discard</IonButton>
        </div>
      )}
    </div>
  );
}
