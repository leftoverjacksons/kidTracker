import { IonButton, IonList } from '@ionic/react';
import { useState } from 'react';
import { useData } from '../../lib/data';
import { useLogged } from '../../lib/feedback';
import { useHousehold } from '../../lib/household';
import { lbOzToG } from '../../lib/units';
import NotesField from '../NotesField';
import NumberField from '../NumberField';
import TimeField from '../TimeField';
import { len } from './units';

export default function GrowthLog({ onDone }: { onDone: () => void }) {
  const { settings } = useHousehold();
  const { add } = useData();
  const logged = useLogged();
  const l = len(settings);
  const imperial = settings.weight_unit === 'lb_oz';
  const [lb, setLb] = useState<number | null>(null);
  const [oz, setOz] = useState<number | null>(null);
  const [kg, setKg] = useState<number | null>(null);
  const [length, setLength] = useState<number | null>(null);
  const [head, setHead] = useState<number | null>(null);
  const [at, setAt] = useState<Date | null>(new Date());
  const [notes, setNotes] = useState('');

  const weightG = imperial
    ? (lb != null || oz != null ? lbOzToG(lb ?? 0, oz ?? 0) : null)
    : (kg != null ? kg * 1000 : null);
  const any = (weightG ?? 0) > 0 || (length ?? 0) > 0 || (head ?? 0) > 0;

  async function save() {
    if (!any) return;
    const r = (n: number | null) => (n != null && n > 0 ? Math.round(n * 10) / 10 : null);
    const e = await add('growth', {
      started_at: (at ?? new Date()).toISOString(),
      weight_g: r(weightG), length_cm: r(length != null ? l.toStore(length) : null),
      head_cm: r(head != null ? l.toStore(head) : null), notes: notes.trim() || null,
    });
    if (e) { logged('Growth logged', e.id); onDone(); }
  }

  return (
    <>
      <p className="hint">Fill in any of these.</p>
      <IonList inset>
        {imperial ? (
          <>
            <NumberField label="Weight" unit="lb" value={lb} onChange={setLb} />
            <NumberField label="+" unit="oz" value={oz} onChange={setOz} />
          </>
        ) : (
          <NumberField label="Weight" unit="kg" value={kg} onChange={setKg} />
        )}
        <NumberField label="Length" unit={l.unit} value={length} onChange={setLength} />
        <NumberField label="Head circumference" unit={l.unit} value={head} onChange={setHead} />
        <TimeField label="Date" value={at} onChange={setAt} />
        <NotesField value={notes} onChange={setNotes} />
      </IonList>
      <IonButton expand="block" size="large" disabled={!any} onClick={save}>Save</IonButton>
    </>
  );
}
