import { IonButton, IonList } from '@ionic/react';
import { useState } from 'react';
import { useData } from '../../lib/data';
import { useLogged } from '../../lib/feedback';
import NotesField from '../NotesField';
import TimeField from '../TimeField';

export default function BathLog({ onDone }: { onDone: () => void }) {
  const { add, autoStop, reopen } = useData();
  const logged = useLogged();
  const [at, setAt] = useState<Date | null>(null);
  const [notes, setNotes] = useState('');

  async function save() {
    const when = at ?? new Date();
    const stopped = await autoStop({ kind: 'bath' }, when);
    const e = await add('bath', { started_at: when.toISOString(), notes: notes.trim() || null });
    if (e) { logged('Bath logged', e.id, stopped); onDone(); } else if (stopped.length) void reopen(stopped);
  }

  return (
    <>
      <button className="big-btn big-btn-wide" onClick={save}><span>🛁</span>{at ? 'Log bath' : 'Bath now'}</button>
      <IonList inset>
        <TimeField label="Time (blank = now)" value={at} onChange={setAt} />
        <NotesField value={notes} onChange={setNotes} />
      </IonList>
      {at && <IonButton fill="clear" expand="block" onClick={() => setAt(null)}>Use current time</IonButton>}
    </>
  );
}
