import { IonButton, IonList, IonNote } from '@ionic/react';
import { useState } from 'react';
import { useData } from '../../lib/data';
import { formatTemp } from '../../lib/format';
import { useLogged } from '../../lib/feedback';
import { useHousehold } from '../../lib/household';
import Chips from '../Chips';
import { cap } from '../../lib/format';
import NotesField from '../NotesField';
import NumberField from '../NumberField';
import TimeField from '../TimeField';
import { temp } from './units';

const METHODS = ['rectal', 'axillary', 'temporal', 'ear', 'oral'].map((m) => ({ value: m, label: cap(m) }));

export default function TempLog({ onDone }: { onDone: () => void }) {
  const { settings } = useHousehold();
  const { add, latest } = useData();
  const logged = useLogged();
  const t = temp(settings);
  const [value, setValue] = useState<number | null>(null);
  const [method, setMethod] = useState<string | null>(latest.temperature?.temp_method ?? null);
  const [at, setAt] = useState<Date | null>(new Date());
  const [notes, setNotes] = useState('');
  const odd = value != null && !t.plausible(value);

  async function save() {
    if (value == null) return;
    const e = await add('temperature', {
      started_at: (at ?? new Date()).toISOString(), temp_c: Math.round(t.toStore(value) * 100) / 100, // 0.01 °C keeps any 0.1 °F reading exact
      temp_method: method, notes: notes.trim() || null,
    });
    if (e) { logged(`Temperature logged: ${formatTemp(e.temp_c, settings)}`, e.id); onDone(); }
  }

  return (
    <>
      <IonList inset>
        <NumberField label="Temperature" unit={t.unit} value={value} onChange={setValue} />
      </IonList>
      {odd && <IonNote color="warning" className="hint">That value looks unusual. Check the unit ({t.unit}).</IonNote>}
      <Chips options={METHODS} value={method} onChange={setMethod} />
      <IonList inset>
        <TimeField label="Time" value={at} onChange={setAt} />
        <NotesField value={notes} onChange={setNotes} />
      </IonList>
      <IonButton expand="block" size="large" disabled={value == null} onClick={save}>Save</IonButton>
    </>
  );
}
