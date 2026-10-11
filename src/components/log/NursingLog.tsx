import { IonButton, IonList, IonSegment, IonSegmentButton, useIonAlert } from '@ionic/react';
import { useState } from 'react';
import { useData, useNow } from '../../lib/data';
import { formatClock } from '../../lib/format';
import { buzz, useLogged } from '../../lib/feedback';
import { activeSide, lastSide, manualSegments, sideTotals } from '../../lib/nursing';
import NotesField from '../NotesField';
import NumberField from '../NumberField';
import TimeField from '../TimeField';
import RunningHeader from './RunningHeader';

const SIDE = { left: 'Left', right: 'Right' } as const;

export default function NursingLog({ onDone }: { onDone: () => void }) {
  const data = useData();
  const now = useNow();
  const [alert] = useIonAlert();
  const [mode, setMode] = useState<'timer' | 'manual'>('timer');
  const running = data.running.nursing;
  const prev = data.latest.nursing;
  const last = prev ? lastSide(prev.nursing_segments ?? []) : null;

  if (running) {
    const segs = running.nursing_segments ?? [];
    const t = sideTotals(segs, now);
    const active = activeSide(segs);
    return (
      <>
        <RunningHeader event={running} ms={t.left + t.right} />
        <div className="side-grid">
          {(['left', 'right'] as const).map((s) => (
            <button key={s} className={`big-btn side-btn ${active === s ? 'side-active' : ''}`}
              onClick={() => { buzz(); void data.setNursingSide(running.id, active === s ? null : s); }}>
              <span className="side-letter">{s === 'left' ? 'L' : 'R'}</span>
              <span className="side-time">{formatClock(t[s])}</span>
              <span className="side-hint">{active === s ? 'tap to pause' : active ? 'switch' : 'resume'}</span>
            </button>
          ))}
        </div>
        <button className="big-btn big-btn-wide big-btn-stop" onClick={async () => {
          buzz();
          if (await data.stopTimer(running.id)) onDone();
        }}>Finish feed</button>
        <IonButton fill="clear" color="danger" expand="block" onClick={() => alert({
          header: 'Discard this feed?',
          buttons: ['Cancel', { text: 'Discard', role: 'destructive', handler: () => { void data.remove(running.id); onDone(); } }],
        })}>Discard</IonButton>
      </>
    );
  }

  return (
    <>
      <IonSegment value={mode} onIonChange={(e) => setMode(e.detail.value as 'timer' | 'manual')}>
        <IonSegmentButton value="timer">Timer</IonSegmentButton>
        <IonSegmentButton value="manual">Enter manually</IonSegmentButton>
      </IonSegment>
      {last && <p className="hint center">Last side: <b>{SIDE[last]}</b></p>}
      {mode === 'timer' ? (
        <div className="side-grid">
          {(['left', 'right'] as const).map((s) => (
            <button key={s} className={`big-btn side-btn ${last && last !== s ? 'side-suggest' : ''}`}
              onClick={async () => {
                buzz();
                const e = await data.startTimer('nursing');
                if (e) await data.setNursingSide(e.id, s);
              }}>
              <span className="side-letter">{s === 'left' ? 'L' : 'R'}</span>
              <span className="side-hint">start {SIDE[s].toLowerCase()}</span>
            </button>
          ))}
        </div>
      ) : (
        <ManualNursing onDone={onDone} defaultFirst={last === 'left' ? 'right' : 'left'} />
      )}
    </>
  );
}

function ManualNursing({ onDone, defaultFirst }: { onDone: () => void; defaultFirst: 'left' | 'right' }) {
  const data = useData();
  const logged = useLogged();
  const [start, setStart] = useState<Date | null>(() => new Date(Date.now() - 20 * 60_000));
  const [leftMin, setLeftMin] = useState<number | null>(null);
  const [rightMin, setRightMin] = useState<number | null>(null);
  const [first, setFirst] = useState<'left' | 'right'>(defaultFirst);
  const [notes, setNotes] = useState('');
  const ok = !!start && ((leftMin ?? 0) > 0 || (rightMin ?? 0) > 0);
  return (
    <>
      <IonList inset>
        <TimeField label="Start" value={start} onChange={setStart} />
        <NumberField label="Left" unit="min" value={leftMin} onChange={setLeftMin} />
        <NumberField label="Right" unit="min" value={rightMin} onChange={setRightMin} />
        <NotesField value={notes} onChange={setNotes} />
      </IonList>
      <p className="hint">Which side first?</p>
      <IonSegment value={first} onIonChange={(e) => setFirst(e.detail.value as 'left' | 'right')}>
        <IonSegmentButton value="left">Left</IonSegmentButton>
        <IonSegmentButton value="right">Right</IonSegmentButton>
      </IonSegment>
      <div className="spacer" />
      <IonButton expand="block" size="large" disabled={!ok} onClick={async () => {
        if (!start) return;
        const segs = manualSegments(start, leftMin ?? 0, rightMin ?? 0, first);
        if (await data.addManualNursing(start, segs, notes.trim() || null)) { logged('Feed logged'); onDone(); }
      }}>Save</IonButton>
    </>
  );
}
