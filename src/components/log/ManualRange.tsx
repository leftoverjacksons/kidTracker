import { IonButton, IonList, IonNote } from '@ionic/react';
import { useState, type ReactNode } from 'react';
import NotesField from '../NotesField';
import TimeField from '../TimeField';

/** "Enter manually" form: start, end, notes, plus any extra fields. */
export default function ManualRange({ onSave, children, defaultMinutes = 30 }: {
  onSave: (start: Date, end: Date, notes: string | null) => Promise<void>;
  children?: ReactNode;
  defaultMinutes?: number;
}) {
  const [end, setEnd] = useState<Date | null>(() => new Date());
  const [start, setStart] = useState<Date | null>(() => new Date(Date.now() - defaultMinutes * 60_000));
  const [notes, setNotes] = useState('');
  const bad = !start || !end || end < start;
  return (
    <>
      <IonList inset>
        <TimeField label="Start" value={start} onChange={setStart} />
        <TimeField label="End" value={end} onChange={setEnd} />
        {children}
        <NotesField value={notes} onChange={setNotes} />
      </IonList>
      {start && end && end < start && <IonNote color="danger" className="hint">End is before start.</IonNote>}
      <IonButton expand="block" size="large" disabled={bad}
        onClick={() => start && end && onSave(start, end, notes.trim() || null)}>
        Save
      </IonButton>
    </>
  );
}
