import { IonButton, IonItem, IonSegment, IonSegmentButton, useIonAlert } from '@ionic/react';
import { useState } from 'react';
import { flowRate } from '../../lib/bottle';
import { useData, useNow } from '../../lib/data';
import { formatDuration, formatFlow, formatVolume } from '../../lib/format';
import { buzz, useLogged } from '../../lib/feedback';
import { useHousehold } from '../../lib/household';
import type { EventRow } from '../../lib/types';
import Chips from '../Chips';
import { useBottleAmounts } from './BottleAmounts';
import NotesField from '../NotesField';
import NumberField from '../NumberField';
import TimeField from '../TimeField';
import TypeIcon from '../TypeIcon';
import RunningHeader from './RunningHeader';
import { vol } from './units';

type Contents = 'breast_milk' | 'formula' | 'mixed';
const MODE_KEY = 'kt.bottleMode';

/**
 * Bottle: a shared timer (start, then enter the amount when done) so flow rate can be
 * tracked, or quick entry of an amount (design doc §8a K). The timer needs migration 0007.
 */
export default function BottleLog({ onDone }: { onDone: () => void }) {
  const data = useData();
  const [mode, setMode] = useState<'timer' | 'amount'>(() => {
    try { return localStorage.getItem(MODE_KEY) === 'amount' ? 'amount' : 'timer'; } catch { return 'timer'; }
  });
  const pick = (m: 'timer' | 'amount') => { setMode(m); try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ } };
  const running = data.running.bottle;
  if (running) return <Finish running={running} onDone={onDone} />;
  if (!data.features.bottleTimer) return <AmountForm onDone={onDone} />;
  return (
    <>
      <IonSegment value={mode} onIonChange={(e) => pick(e.detail.value as 'timer' | 'amount')}>
        <IonSegmentButton value="timer">Timer</IonSegmentButton>
        <IonSegmentButton value="amount">Enter amount</IonSegmentButton>
      </IonSegment>
      {mode === 'timer' ? <Start /> : <AmountForm onDone={onDone} />}
    </>
  );
}

function Start() {
  const { settings } = useHousehold();
  const data = useData();
  const logged = useLogged();
  const v = vol(settings);
  const [inBottle, setInBottle] = useState<number | null>(null);
  return (
    <>
      {data.features.bottleStart && (
        <>
          <p className="hint center bottle-q">In the bottle (optional, saves typing later)</p>
          <Chips options={v.quick.map((q) => ({ value: q, label: `${q} ${v.unit}` }))} value={inBottle} onChange={setInBottle} />
        </>
      )}
      <button className="big-btn big-btn-wide big-btn-start" onClick={async () => {
        buzz();
        const stopped = await data.autoStop({ kind: 'bottle' });
        const e = await data.startTimer('bottle');
        if (e && inBottle != null && data.features.bottleStart) await data.update(e.id, { bottle_start_ml: v.toStore(inBottle) });
        if (stopped.length) logged('Bottle started', undefined, stopped);
      }}><TypeIcon type="bottle" />Start bottle</button>
      <p className="hint center">Start when the feed starts. When it's done, enter what's left (or how much he drank). Flow rate = amount ÷ time.</p>
    </>
  );
}

/** Running bottle: live clock, then how much was drunk, then Finish. */
function Finish({ running, onDone }: { running: EventRow; onDone: () => void }) {
  const { settings } = useHousehold();
  const data = useData();
  const now = useNow();
  const [alert] = useIonAlert();
  const [contents, setContents] = useState<Contents>(data.latest.bottle?.bottle_contents ?? 'breast_milk');
  const { ui, drankMl: ml, startMl } = useBottleAmounts(settings, running.bottle_start_ml ?? null, (
    <>
      <IonItem>
        <IonSegment value={contents} onIonChange={(e) => setContents(e.detail.value as Contents)}>
          <IonSegmentButton value="breast_milk">Breast milk</IonSegmentButton>
          <IonSegmentButton value="formula">Formula</IonSegmentButton>
          <IonSegmentButton value="mixed">Mixed</IonSegmentButton>
        </IonSegment>
      </IonItem>
      <TimeField label="Started at (adjust if started earlier)" value={new Date(running.started_at)}
        onChange={(d) => d && d <= new Date() && void data.update(running.id, { started_at: d.toISOString() })} />
    </>
  ));
  const rate = ml ? flowRate({ type: 'bottle', started_at: running.started_at, ended_at: now.toISOString(), bottle_ml: ml }) : null;

  async function finish() {
    if (!ml) return;
    buzz();
    if (await data.stopTimer(running.id)) {
      await data.update(running.id, { bottle_ml: ml, bottle_contents: contents, ...(data.features.bottleStart ? { bottle_start_ml: startMl } : {}) });
      onDone();
    }
  }

  return (
    <>
      <RunningHeader event={running} />
      {ui}
      {rate != null && <p className="hint center bottle-rate">{formatVolume(ml, settings)} in {formatDuration(now.getTime() - Date.parse(running.started_at))} = {formatFlow(rate, settings)}</p>}
      <button className="big-btn big-btn-wide big-btn-stop" disabled={!ml} onClick={() => void finish()}>
        {ml ? `Finish · drank ${formatVolume(ml, settings)}` : 'Enter the amounts to finish'}
      </button>
      <IonButton fill="clear" color="danger" expand="block" onClick={() => alert({
        header: 'Discard this bottle?', message: 'The running timer is deleted.',
        buttons: ['Cancel', { text: 'Discard', role: 'destructive', handler: () => { void data.remove(running.id); onDone(); } }],
      })}>Discard</IonButton>
    </>
  );
}

/** Quick entry: amount, contents, time, and optionally how long it took. */
function AmountForm({ onDone }: { onDone: () => void }) {
  const { settings } = useHousehold();
  const { add, latest, autoStop, reopen, features } = useData();
  const logged = useLogged();
  const [contents, setContents] = useState<Contents>(latest.bottle?.bottle_contents ?? 'breast_milk');
  const [at, setAt] = useState<Date | null>(new Date());
  const [minutes, setMinutes] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const { ui, drankMl, startMl } = useBottleAmounts(settings, null, (
    <>
      <IonItem>
        <IonSegment value={contents} onIonChange={(e) => setContents(e.detail.value as Contents)}>
          <IonSegmentButton value="breast_milk">Breast milk</IonSegmentButton>
          <IonSegmentButton value="formula">Formula</IonSegmentButton>
          <IonSegmentButton value="mixed">Mixed</IonSegmentButton>
        </IonSegment>
      </IonItem>
      <TimeField label="Time" value={at} onChange={setAt} />
      <NumberField label="How long it took (optional)" unit="min" value={minutes} onChange={setMinutes} />
      <NotesField value={notes} onChange={setNotes} />
    </>
  ));

  async function save() {
    if (drankMl == null) return;
    const when = at ?? new Date();
    const stopped = await autoStop({ kind: 'bottle' }, when);
    // An end time is always set: equal to the start for an untimed bottle, so it never
    // looks like a running bottle timer (migration 0007).
    const end = minutes && minutes > 0 ? new Date(when.getTime() + minutes * 60_000) : when;
    const e = await add('bottle', {
      started_at: when.toISOString(), ended_at: end.toISOString(), bottle_ml: drankMl,
      bottle_contents: contents, notes: notes.trim() || null, ...(features.bottleStart && startMl ? { bottle_start_ml: startMl } : {}),
    });
    if (e) { logged(`Bottle logged: ${formatVolume(e.bottle_ml, settings)}`, e.id, stopped); onDone(); } else if (stopped.length) void reopen(stopped);
  }

  return (
    <>
      {ui}
      <IonButton expand="block" size="large" disabled={drankMl == null} onClick={save}>Save</IonButton>
    </>
  );
}
