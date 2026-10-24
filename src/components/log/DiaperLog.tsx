import { IonButton, IonCheckbox, IonItem, IonList } from '@ionic/react';
import { useEffect, useRef, useState } from 'react';
import { useData } from '../../lib/data';
import { diaperLabel } from '../../lib/describe';
import { useLogged } from '../../lib/feedback';
import Chips from '../Chips';
import { cap, formatTime } from '../../lib/format';
import type { EventFields } from '../../lib/types';
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

/**
 * The first tap on a type logs the diaper right away. The sheet then stays open:
 * each detail is saved to that same diaper as it's chosen, and tapping another type
 * corrects it instead of logging a second one. Done (or swiping the sheet away) closes.
 */
export default function DiaperLog({ onDone }: { onDone: () => void }) {
  const { add, update, autoStop, reopen, events } = useData();
  const logged = useLogged();
  const [id, setId] = useState<string | null>(null);
  const [kind, setKind] = useState<{ wet: boolean; dirty: boolean } | null>(null);
  const [at, setAt] = useState<Date | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [consistency, setConsistency] = useState<string | null>(null);
  const [rash, setRash] = useState(false);
  const [notes, setNotes] = useState('');
  const saving = useRef(false);

  // Undo from the toast deletes the diaper: go back to the type buttons.
  useEffect(() => {
    if (id && !saving.current && !events.some((e) => e.id === id)) { setId(null); setKind(null); }
  }, [events, id]);

  async function save(fields: EventFields) { if (id) await update(id, fields); }

  async function pick(wet: boolean, dirty: boolean) {
    setKind({ wet, dirty });
    if (id) { await save({ diaper_wet: wet, diaper_dirty: dirty, ...(dirty ? {} : { poop_color: null, poop_consistency: null }) }); return; }
    saving.current = true;
    const when = new Date();
    const stopped = await autoStop({ kind: 'diaper' }, when);
    const e = await add('diaper', { started_at: when.toISOString(), diaper_wet: wet, diaper_dirty: dirty });
    saving.current = false;
    if (e) { setId(e.id); setAt(when); logged(`Diaper logged: ${diaperLabel(e)}`, e.id, stopped); }
    else { setKind(null); if (stopped.length) void reopen(stopped); }
  }

  // Notes save once typing pauses, not on every keystroke.
  useEffect(() => {
    if (!id) return;
    const t = setTimeout(() => void save({ notes: notes.trim() || null }), 700);
    return () => clearTimeout(t);
  }, [notes]); // eslint-disable-line react-hooks/exhaustive-deps

  const isOn = (t: (typeof TYPES)[number]) => kind != null && kind.wet === t.wet && kind.dirty === t.dirty;

  return (
    <>
      {id && kind && at && <p className="diaper-saved">Saved: <b>{diaperLabel({ diaper_wet: kind.wet, diaper_dirty: kind.dirty })}</b> · {formatTime(at)}</p>}
      <div className="big-grid">
        {TYPES.map((t) => (
          <button key={t.label} className={`big-btn ${isOn(t) ? 'big-btn-on' : ''}`} aria-pressed={isOn(t)} onClick={() => void pick(t.wet, t.dirty)}>
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>
      {!id ? (
        <p className="hint">Tap a type to log it now. Details can be added right after.</p>
      ) : (
        <>
          <IonList inset>
            {kind?.dirty && (
              <>
                <IonItem lines="none"><div className="field-label">Poop color</div></IonItem>
                <IonItem><Chips options={COLORS} value={color} onChange={(v) => { setColor(v); void save({ poop_color: v }); }} /></IonItem>
                <IonItem lines="none"><div className="field-label">Consistency</div></IonItem>
                <IonItem><Chips options={CONSISTENCY} value={consistency} onChange={(v) => { setConsistency(v); void save({ poop_consistency: v }); }} /></IonItem>
              </>
            )}
            <IonItem>
              <IonCheckbox checked={rash} labelPlacement="end"
                onIonChange={(e) => { setRash(e.detail.checked); void save({ diaper_rash: e.detail.checked || null }); }}>Diaper rash</IonCheckbox>
            </IonItem>
            <TimeField label="Time" value={at} onChange={(d) => { if (!d) return; setAt(d); void save({ started_at: d.toISOString() }); }} />
            <NotesField value={notes} onChange={setNotes} />
          </IonList>
          <IonButton expand="block" onClick={() => { void save({ notes: notes.trim() || null }); onDone(); }}>Done</IonButton>
        </>
      )}
    </>
  );
}
