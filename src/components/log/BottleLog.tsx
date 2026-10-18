import { IonButton, IonItem, IonList, IonSegment, IonSegmentButton } from '@ionic/react';
import { useState } from 'react';
import { useData } from '../../lib/data';
import { formatVolume } from '../../lib/format';
import { useLogged } from '../../lib/feedback';
import { useHousehold } from '../../lib/household';
import Chips from '../Chips';
import NotesField from '../NotesField';
import NumberField from '../NumberField';
import TimeField from '../TimeField';
import { vol } from './units';

type Contents = 'breast_milk' | 'formula' | 'mixed';

export default function BottleLog({ onDone }: { onDone: () => void }) {
  const { settings } = useHousehold();
  const { add, latest, autoStop, reopen } = useData();
  const logged = useLogged();
  const v = vol(settings);
  const [amount, setAmount] = useState<number | null>(null);
  const [contents, setContents] = useState<Contents>(latest.bottle?.bottle_contents ?? 'breast_milk');
  const [at, setAt] = useState<Date | null>(new Date());
  const [notes, setNotes] = useState('');

  async function save() {
    if (amount == null || amount <= 0) return;
    const when = at ?? new Date();
    const stopped = await autoStop({ kind: 'bottle' }, when);
    const e = await add('bottle', {
      started_at: when.toISOString(), bottle_ml: v.toStore(amount),
      bottle_contents: contents, notes: notes.trim() || null,
    });
    if (e) { logged(`Bottle logged: ${formatVolume(e.bottle_ml, settings)}`, e.id, stopped); onDone(); } else if (stopped.length) void reopen(stopped);
  }

  return (
    <>
      <Chips options={v.quick.map((q) => ({ value: q, label: `${q} ${v.unit}` }))} value={amount}
        onChange={setAmount} />
      <IonList inset>
        <NumberField label="Amount" unit={v.unit} value={amount} onChange={setAmount} />
        <IonItem>
          <IonSegment value={contents} onIonChange={(e) => setContents(e.detail.value as Contents)}>
            <IonSegmentButton value="breast_milk">Breast milk</IonSegmentButton>
            <IonSegmentButton value="formula">Formula</IonSegmentButton>
            <IonSegmentButton value="mixed">Mixed</IonSegmentButton>
          </IonSegment>
        </IonItem>
        <TimeField label="Time" value={at} onChange={setAt} />
        <NotesField value={notes} onChange={setNotes} />
      </IonList>
      <IonButton expand="block" size="large" disabled={amount == null || amount <= 0} onClick={save}>Save</IonButton>
    </>
  );
}
