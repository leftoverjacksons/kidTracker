import { IonButton, IonList, IonSegment, IonSegmentButton, useIonAlert } from '@ionic/react';
import { useState } from 'react';
import { useData } from '../../lib/data';
import { META } from '../../lib/describe';
import { formatDuration } from '../../lib/format';
import { buzz, useLogged } from '../../lib/feedback';
import TimeField from '../TimeField';
import ManualRange from './ManualRange';
import RunningHeader from './RunningHeader';

/** Sleep and tummy time: shared start/stop timer, or manual entry. */
export default function TimerLog({ type, onDone }: { type: 'sleep' | 'tummy_time'; onDone: () => void }) {
  const data = useData();
  const logged = useLogged();
  const [alert] = useIonAlert();
  const [mode, setMode] = useState<'timer' | 'manual'>('timer');
  const running = data.running[type];
  const label = META[type].label;

  if (running) {
    return (
      <>
        <RunningHeader event={running} />
        <button className="big-btn big-btn-wide big-btn-stop" onClick={async () => {
          buzz();
          if (await data.stopTimer(running.id)) onDone();
        }}>Stop</button>
        <IonList inset>
          <TimeField label="Started at (adjust if started earlier)" value={new Date(running.started_at)}
            onChange={(d) => d && d <= new Date() && void data.update(running.id, { started_at: d.toISOString() })} />
        </IonList>
        <IonButton fill="clear" color="danger" expand="block" onClick={() => alert({
          header: `Discard this ${label.toLowerCase()}?`, message: 'The running timer is deleted.',
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
      {mode === 'timer' ? (
        <button className="big-btn big-btn-wide big-btn-start" onClick={async () => {
          buzz();
          const stopped = await data.autoStop({ kind: type === 'sleep' ? 'start_sleep' : 'start_tummy' });
          await data.startTimer(type);
          if (stopped.length) logged(`${label} started`, undefined, stopped);
        }}><span>{META[type].emoji}</span>Start {label.toLowerCase()}</button>
      ) : (
        <ManualRange defaultMinutes={type === 'sleep' ? 60 : 10} onSave={async (start, end, notes) => {
          const e = await data.add(type, { started_at: start.toISOString(), ended_at: end.toISOString(), notes });
          if (e) { logged(`${label} logged: ${formatDuration(end.getTime() - start.getTime())}`, e.id); onDone(); }
        }} />
      )}
    </>
  );
}
