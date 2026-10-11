import { IonButton, IonCheckbox, IonItem, IonList } from '@ionic/react';
import { useState } from 'react';
import { useData } from '../../lib/data';
import { diaperLabel } from '../../lib/describe';
import { useLogged } from '../../lib/feedback';
import Chips from '../Chips';
import { cap } from '../../lib/format';
import NotesField from '../NotesField';
import TimeField from '../TimeField';

const COLORS = ['yellow', 'green', 'brown', 'black', 'red', 'white'].map((c) => ({ value: c, label: cap(c) }));
const CONSISTENCY = ['watery', 'seedy', 'soft', 'formed', 'hard'].map((c) => ({ value: c, label: cap(c) }));

/** One tap on a type logs it immediately; details are optional. */
export default function DiaperLog({ onDone }: { onDone: () => void }) {
  const { add } = useData();
  const logged = useLogged();
  const [more, setMore] = useState(false);
  const [at, setAt] = useState<Date | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [consistency, setConsistency] = useState<string | null>(null);
  const [rash, setRash] = useState(false);
  const [notes, setNotes] = useState('');

  async function log(wet: boolean, dirty: boolean) {
    const e = await add('diaper', {
      started_at: (at ?? new Date()).toISOString(),
      diaper_wet: wet, diaper_dirty: dirty,
      poop_color: dirty ? color : null, poop_consistency: dirty ? consistency : null,
      diaper_rash: rash || null, notes: notes.trim() || null,
    });
    if (e) { logged(`Diaper logged: ${diaperLabel(e)}`, e.id); onDone(); }
  }

  return (
    <>
      <div className="big-grid">
        <button className="big-btn" onClick={() => log(true, false)}><span>💧</span>Wet</button>
        <button className="big-btn" onClick={() => log(false, true)}><span>💩</span>Dirty</button>
        <button className="big-btn" onClick={() => log(true, true)}><span>💧💩</span>Both</button>
        <button className="big-btn" onClick={() => log(false, false)}><span>⭕</span>Dry</button>
      </div>
      {!more ? (
        <IonButton fill="clear" expand="block" onClick={() => setMore(true)}>Add details or change time</IonButton>
      ) : (
        <>
          <p className="hint">Set details first, then tap a type above.</p>
          <IonList inset>
            <TimeField label="Time (blank = now)" value={at} onChange={setAt} />
            <IonItem lines="none"><div className="field-label">Poop color</div></IonItem>
            <IonItem><Chips options={COLORS} value={color} onChange={setColor} /></IonItem>
            <IonItem lines="none"><div className="field-label">Consistency</div></IonItem>
            <IonItem><Chips options={CONSISTENCY} value={consistency} onChange={setConsistency} /></IonItem>
            <IonItem>
              <IonCheckbox checked={rash} onIonChange={(e) => setRash(e.detail.checked)} labelPlacement="end">Diaper rash</IonCheckbox>
            </IonItem>
            <NotesField value={notes} onChange={setNotes} />
          </IonList>
        </>
      )}
    </>
  );
}
