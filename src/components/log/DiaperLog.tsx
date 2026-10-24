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
const TYPES = [
  { wet: true, dirty: false, icon: '💧', label: 'Wet' },
  { wet: false, dirty: true, icon: '💩', label: 'Dirty' },
  { wet: true, dirty: true, icon: '💧💩', label: 'Both' },
  { wet: false, dirty: false, icon: '⭕', label: 'Dry' },
];

/** Pick a type, optionally the details (all on one screen), then Save. */
export default function DiaperLog({ onDone }: { onDone: () => void }) {
  const { add, autoStop, reopen } = useData();
  const logged = useLogged();
  const [kind, setKind] = useState<{ wet: boolean; dirty: boolean } | null>(null);
  const [at, setAt] = useState<Date | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [consistency, setConsistency] = useState<string | null>(null);
  const [rash, setRash] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  // Poop details only apply to Dirty or Both; greyed out once Wet or Dry is picked.
  const poopOff = kind != null && !kind.dirty;

  async function save() {
    if (!kind || busy) return;
    setBusy(true);
    const when = at ?? new Date();
    const stopped = await autoStop({ kind: 'diaper' }, when);
    const e = await add('diaper', {
      started_at: when.toISOString(),
      diaper_wet: kind.wet, diaper_dirty: kind.dirty,
      poop_color: kind.dirty ? color : null, poop_consistency: kind.dirty ? consistency : null,
      diaper_rash: rash || null, notes: notes.trim() || null,
    });
    setBusy(false);
    if (e) { logged(`Diaper logged: ${diaperLabel(e)}`, e.id, stopped); onDone(); } else if (stopped.length) void reopen(stopped);
  }

  const isOn = (t: (typeof TYPES)[number]) => kind != null && kind.wet === t.wet && kind.dirty === t.dirty;

  return (
    <>
      <div className="big-grid">
        {TYPES.map((t) => (
          <button key={t.label} className={`big-btn ${isOn(t) ? 'big-btn-on' : ''}`} aria-pressed={isOn(t)}
            onClick={() => setKind({ wet: t.wet, dirty: t.dirty })}>
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>
      <IonList inset>
        <div className={poopOff ? 'fields-off' : undefined} aria-disabled={poopOff}>
          <IonItem lines="none"><div className="field-label">Poop color</div></IonItem>
          <IonItem><Chips options={COLORS} value={color} onChange={setColor} /></IonItem>
          <IonItem lines="none"><div className="field-label">Consistency</div></IonItem>
          <IonItem><Chips options={CONSISTENCY} value={consistency} onChange={setConsistency} /></IonItem>
        </div>
        <IonItem>
          <IonCheckbox checked={rash} onIonChange={(e) => setRash(e.detail.checked)} labelPlacement="end">Diaper rash</IonCheckbox>
        </IonItem>
        <TimeField label="Time (blank = now)" value={at} onChange={setAt} />
        <NotesField value={notes} onChange={setNotes} />
      </IonList>
      <IonButton expand="block" disabled={!kind || busy} onClick={() => void save()}>{kind ? 'Save' : 'Pick a type to save'}</IonButton>
    </>
  );
}
