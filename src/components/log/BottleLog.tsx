import { IonButton, IonItem, IonList, IonSegment, IonSegmentButton, IonSelect, IonSelectOption, useIonAlert } from '@ionic/react';
import { useState } from 'react';
import { activeMs, BOTTLE_BRANDS, flowRate } from '../../lib/bottle';
import { useData, useNow } from '../../lib/data';
import { formatDuration, formatFlow, formatVolume } from '../../lib/format';
import { buzz, useLogged } from '../../lib/feedback';
import { useHousehold } from '../../lib/household';
import type { EventRow } from '../../lib/types';
import NotesField from '../NotesField';
import NumberField from '../NumberField';
import TimeField from '../TimeField';
import TypeIcon from '../TypeIcon';
import { useBottleAmounts } from './BottleAmounts';
import RunningHeader from './RunningHeader';
import { vol } from './units';

type Contents = 'breast_milk' | 'formula' | 'mixed';
/** A stopped bottle still waiting for "left in the bottle" is offered again for this long. */
const AWAIT_LEFTOVER_MS = 3 * 3_600_000;

/**
 * Bottle (design doc §8a K, typed flow 2026-10-20):
 *   1. type how much is in the bottle → Start
 *   2. Stop when the feed ends
 *   3. type how much is left → amount drunk and flow rate are saved.
 * A stopped bottle without its left-over amount is picked up again (sleepy parents).
 * "Forgot to time it?" opens a plain entry form. Without migration 0007 only the form shows.
 */
export default function BottleLog({ onDone }: { onDone: () => void }) {
  const data = useData();
  const [manual, setManual] = useState(false);
  const [stoppedId, setStoppedId] = useState<string | null>(null);
  const running = data.running.bottle;
  // Most recent finished, timed bottle that still has no amount (stopped, then the sheet closed).
  const waiting = data.events.find((e) => e.type === 'bottle' && (e.id === stoppedId || (
    e.ended_at && e.bottle_ml == null && Date.parse(e.ended_at) > Date.parse(e.started_at)
    && Date.now() - Date.parse(e.ended_at) < AWAIT_LEFTOVER_MS)));

  if (!data.features.bottleTimer || manual) {
    return <>
      <ManualForm onDone={onDone} />
      {data.features.bottleTimer && <IonButton fill="clear" expand="block" onClick={() => setManual(false)}>Back to the timer</IonButton>}
    </>;
  }
  if (running) return <Running running={running} onStopped={(id) => setStoppedId(id)} onDone={onDone} />;
  if (waiting) return <Leftover bottle={waiting} onDone={onDone} />;
  return <>
    <Start />
    <IonButton fill="clear" expand="block" onClick={() => setManual(true)}>Forgot to time it? Enter a past bottle</IonButton>
  </>;
}

function ContentsPicker({ value, onChange }: { value: Contents; onChange: (c: Contents) => void }) {
  return (
    <IonItem>
      <IonSegment value={value} onIonChange={(e) => onChange(e.detail.value as Contents)}>
        <IonSegmentButton value="breast_milk">Breast milk</IonSegmentButton>
        <IonSegmentButton value="formula">Formula</IonSegmentButton>
        <IonSegmentButton value="mixed">Mixed</IonSegmentButton>
      </IonSegment>
    </IonItem>
  );
}

/** Which bottle (brand), to compare flow (migration 0008). */
function BrandPicker({ value, onChange }: { value: string | null; onChange: (b: string | null) => void }) {
  return (
    <IonItem>
      <IonSelect label="Bottle" labelPlacement="stacked" interface="action-sheet" placeholder="Choose the bottle"
        value={value ?? ''} onIonChange={(e) => onChange(e.detail.value || null)}>
        {BOTTLE_BRANDS.map((b) => <IonSelectOption key={b} value={b}>{b}</IonSelectOption>)}
      </IonSelect>
    </IonItem>
  );
}

/** 1. How much is in the bottle → Start. */
function Start() {
  const { settings } = useHousehold();
  const data = useData();
  const logged = useLogged();
  const v = vol(settings);
  const [inBottle, setInBottle] = useState<number | null>(null);
  const [contents, setContents] = useState<Contents>(data.latest.bottle?.bottle_contents ?? 'breast_milk');
  const [brand, setBrand] = useState<string | null>(data.latest.bottle?.bottle_brand ?? null);
  const ok = inBottle != null && inBottle > 0;
  return (
    <>
      <IonList inset>
        <NumberField label="In the bottle" unit={v.unit} value={inBottle} onChange={setInBottle} autoFocus />
        <ContentsPicker value={contents} onChange={setContents} />
        {data.features.bottleBrand && <BrandPicker value={brand} onChange={setBrand} />}
      </IonList>
      <button className="big-btn big-btn-wide big-btn-start" disabled={!ok} onClick={async () => {
        if (!ok) return;
        buzz();
        const stopped = await data.autoStop({ kind: 'bottle' });
        const e = await data.startTimer('bottle');
        if (e) await data.update(e.id, { bottle_contents: contents, ...(data.features.bottleStart ? { bottle_start_ml: v.toStore(inBottle!) } : {}), ...(data.features.bottleBrand ? { bottle_brand: brand } : {}) });
        if (stopped.length) logged('Bottle started', undefined, stopped);
      }}><TypeIcon type="bottle" />{ok ? 'Start' : 'Type the amount, then Start'}</button>
    </>
  );
}

/** 2. Running: clock, then Stop. */
function Running({ running, onStopped, onDone }: { running: EventRow; onStopped: (id: string) => void; onDone: () => void }) {
  const { settings } = useHousehold();
  const data = useData();
  const now = useNow();
  const [alert] = useIonAlert();
  const paused = !!running.paused_at;
  return (
    <>
      <RunningHeader event={running} ms={activeMs(running, now)} />
      {paused && <p className="hint center bottle-paused">Paused — the clock isn't counting.</p>}
      {running.bottle_start_ml != null && <p className="hint center bottle-q">In the bottle: <b>{formatVolume(running.bottle_start_ml, settings)}</b>{running.bottle_brand ? ` · ${running.bottle_brand}` : ''}</p>}
      {data.features.bottlePause && (
        <button className={`big-btn big-btn-wide ${paused ? 'big-btn-start' : 'big-btn-pause'}`} onClick={() => {
          buzz();
          void (paused ? data.resumeTimer(running.id) : data.pauseTimer(running.id));
        }}>{paused ? 'Resume' : 'Pause'}</button>
      )}
      <button className="big-btn big-btn-wide big-btn-stop" onClick={async () => {
        buzz();
        if (await data.stopTimer(running.id)) onStopped(running.id);
      }}>Stop</button>
      <IonList inset>
        <TimeField label="Started at (adjust if started earlier)" value={new Date(running.started_at)}
          onChange={(d) => d && d <= new Date() && void data.update(running.id, { started_at: d.toISOString() })} />
      </IonList>
      <IonButton fill="clear" color="danger" expand="block" onClick={() => alert({
        header: 'Discard this bottle?', message: 'The running timer is deleted.',
        buttons: ['Cancel', { text: 'Discard', role: 'destructive', handler: () => { void data.remove(running.id); onDone(); } }],
      })}>Discard</IonButton>
    </>
  );
}

/** 3. Stopped: how much is left → amount drunk and flow rate. */
function Leftover({ bottle, onDone }: { bottle: EventRow; onDone: () => void }) {
  const { settings } = useHousehold();
  const data = useData();
  const logged = useLogged();
  const [alert] = useIonAlert();
  const v = vol(settings);
  const known = bottle.bottle_start_ml != null;
  const [start, setStart] = useState<number | null>(known ? v.toShow(bottle.bottle_start_ml!) : null);
  const [left, setLeft] = useState<number | null>(null);
  const over = start != null && left != null && left > start;
  const drankMl = start != null && left != null && !over ? Math.max(0, v.toStore(start) - v.toStore(left)) : null;
  const rate = drankMl != null ? flowRate({ ...bottle, bottle_ml: drankMl }) : null;
  const ms = activeMs(bottle); // pauses not counted

  async function save() {
    if (drankMl == null) return;
    buzz();
    const ok = await data.update(bottle.id, { bottle_ml: Math.round(drankMl * 10) / 10, ...(data.features.bottleStart && start != null ? { bottle_start_ml: v.toStore(start) } : {}) });
    if (ok) { logged(`Bottle: drank ${formatVolume(drankMl, settings)}${rate ? ` · ${formatFlow(rate, settings)}` : ''}`, undefined); onDone(); }
  }

  return (
    <>
      <div className="running">
        <div className="clock">{formatDuration(ms)}</div>
        <div className="hint">Bottle stopped{known ? ` · started with ${formatVolume(bottle.bottle_start_ml, settings)}` : ''}{bottle.paused_s ? ` · ${formatDuration(bottle.paused_s * 1000)} paused, not counted` : ''}</div>
      </div>
      <IonList inset>
        {!known && <NumberField label="In the bottle at the start" unit={v.unit} value={start} onChange={setStart} />}
        <NumberField label="Left in the bottle" unit={v.unit} value={left} onChange={setLeft} autoFocus />
      </IonList>
      <p className={`hint center bottle-drank ${over ? 'bottle-err' : ''}`}>
        {over ? 'More is left than was in the bottle.' : drankMl != null
          ? <>Drank <b>{formatVolume(drankMl, settings)}</b>{rate ? <> · <b>{formatFlow(rate, settings)}</b></> : null}</>
          : 'Type what is left (0 if empty).'}
      </p>
      <button className="big-btn big-btn-wide big-btn-start" disabled={drankMl == null} onClick={() => void save()}>Save</button>
      <IonButton fill="clear" color="danger" expand="block" onClick={() => alert({
        header: 'Delete this bottle?', message: 'It was stopped but has no amount yet.',
        buttons: ['Cancel', { text: 'Delete', role: 'destructive', handler: () => { void data.remove(bottle.id); onDone(); } }],
      })}>Delete this bottle</IonButton>
    </>
  );
}

/** Plain entry for a bottle that wasn't timed: amounts, contents, time, optional duration. */
function ManualForm({ onDone }: { onDone: () => void }) {
  const { settings } = useHousehold();
  const { add, latest, autoStop, reopen, features } = useData();
  const logged = useLogged();
  const [contents, setContents] = useState<Contents>(latest.bottle?.bottle_contents ?? 'breast_milk');
  const [at, setAt] = useState<Date | null>(new Date());
  const [minutes, setMinutes] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [brand, setBrand] = useState<string | null>(latest.bottle?.bottle_brand ?? null);
  const { ui, drankMl, startMl } = useBottleAmounts(settings, null, (
    <>
      <ContentsPicker value={contents} onChange={setContents} />
      {features.bottleBrand && <BrandPicker value={brand} onChange={setBrand} />}
      <TimeField label="Time" value={at} onChange={setAt} />
      <NumberField label="How long it took (optional)" unit="min" value={minutes} onChange={setMinutes} />
      <NotesField value={notes} onChange={setNotes} />
    </>
  ));

  async function save() {
    if (drankMl == null) return;
    const when = at ?? new Date();
    const stopped = await autoStop({ kind: 'bottle' }, when);
    // Always an end time: equal to the start when untimed, so it never looks like a running timer (0007).
    const end = minutes && minutes > 0 ? new Date(when.getTime() + minutes * 60_000) : when;
    const e = await add('bottle', {
      started_at: when.toISOString(), ended_at: end.toISOString(), bottle_ml: drankMl,
      bottle_contents: contents, notes: notes.trim() || null, ...(features.bottleStart && startMl ? { bottle_start_ml: startMl } : {}),
      ...(features.bottleBrand && brand ? { bottle_brand: brand } : {}),
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
