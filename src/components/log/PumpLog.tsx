import { IonButton, IonList, IonSegment, IonSegmentButton, useIonAlert } from '@ionic/react';
import { useEffect, useState } from 'react';
import { useData } from '../../lib/data';
import { buzz, useLogged } from '../../lib/feedback';
import { useHousehold } from '../../lib/household';
import NumberField from '../NumberField';
import PumpGauge from '../PumpGauge';
import { PUMP_MIN_MINUTES, PUMP_TARGET, pumpCounts } from '../../lib/pump';
import ManualRange from './ManualRange';
import RunningHeader from './RunningHeader';
import { vol } from './units';

type Side = 'left' | 'right' | 'both';

export default function PumpLog({ onDone }: { onDone: () => void }) {
  const { settings } = useHousehold();
  const data = useData();
  const logged = useLogged();
  const [alert] = useIonAlert();
  const v = vol(settings);
  const running = data.running.pump;
  const [mode, setMode] = useState<'timer' | 'manual'>('timer');
  const [side, setSide] = useState<Side>(running?.pump_side ?? data.latest.pump?.pump_side ?? 'both');
  const [left, setLeft] = useState<number | null>(null);
  const [right, setRight] = useState<number | null>(null);
  useEffect(() => { if (running?.pump_side) setSide(running.pump_side); }, [running?.pump_side]);

  const amounts = () => ({
    pump_side: side,
    pump_left_ml: side !== 'right' && left != null ? v.toStore(left) : null,
    pump_right_ml: side !== 'left' && right != null ? v.toStore(right) : null,
  });

  const chooseSide = (s: Side) => {
    setSide(s);
    if (running) void data.update(running.id, { pump_side: s });
  };
  // Large L/R gauges: 15+ min sessions in the last 24 h. Tapping one picks that side;
  // tapping the other while one is picked selects both.
  const counts = pumpCounts(data.events);
  const tapGauge = (g: 'left' | 'right') => {
    const other = g === 'left' ? 'right' : 'left';
    chooseSide(side === g ? g : side === other ? 'both' : side === 'both' ? other : g);
  };
  const gauges = (
    <div className="pump-gauges-large">
      {(['left', 'right'] as const).map((g) => (
        <button key={g} className="gauge-btn" aria-pressed={side === g || side === 'both'} onClick={() => tapGauge(g)}>
          <PumpGauge side={g === 'left' ? 'L' : 'R'} count={counts[g]} selected={side === g || side === 'both'} />
        </button>
      ))}
      <p className="hint center gauge-caption">
        Sessions of {PUMP_MIN_MINUTES}+ min in the last 24 h · target {PUMP_TARGET.min}–{PUMP_TARGET.max} per side. Tap a breast to pick it.
      </p>
    </div>
  );
  const sidePicker = (
    <IonSegment value={side} onIonChange={(e) => chooseSide(e.detail.value as Side)}>
      <IonSegmentButton value="left">Left</IonSegmentButton>
      <IonSegmentButton value="right">Right</IonSegmentButton>
      <IonSegmentButton value="both">Both</IonSegmentButton>
    </IonSegment>
  );
  const amountFields = (
    <>
      {side !== 'right' && <NumberField label="Left amount" unit={v.unit} value={left} onChange={setLeft} />}
      {side !== 'left' && <NumberField label="Right amount" unit={v.unit} value={right} onChange={setRight} />}
    </>
  );

  if (running) {
    return (
      <>
        <RunningHeader event={running} />
        {gauges}
        {sidePicker}
        <IonList inset>{amountFields}</IonList>
        <button className="big-btn big-btn-wide big-btn-stop" onClick={async () => {
          buzz();
          if (await data.stopTimer(running.id)) { await data.update(running.id, amounts()); onDone(); }
        }}>Stop &amp; save</button>
        <p className="hint">Amounts can also be added later from History.</p>
        <IonButton fill="clear" color="danger" expand="block" onClick={() => alert({
          header: 'Discard this pumping session?',
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
      <div className="spacer" />
      {gauges}
      {sidePicker}
      {mode === 'timer' ? (
        <button className="big-btn big-btn-wide big-btn-start" onClick={async () => {
          buzz();
          const stopped = await data.autoStop({ kind: 'start_pump', side });
          await data.startTimer('pump', new Date(), { pump_side: side });
          if (stopped.length) logged('Pumping started', undefined, stopped);
        }}><span>🥛</span>Start pumping</button>
      ) : (
        <ManualRange defaultMinutes={15} onSave={async (start, end, notes) => {
          const e = await data.add('pump', { started_at: start.toISOString(), ended_at: end.toISOString(), notes, ...amounts() });
          if (e) { logged('Pumping logged', e.id); onDone(); }
        }}>{amountFields}</ManualRange>
      )}
    </>
  );
}
