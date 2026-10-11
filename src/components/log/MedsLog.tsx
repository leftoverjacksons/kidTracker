import { IonButton, IonInput, IonItem, IonLabel, IonList, IonNote } from '@ionic/react';
import { useState } from 'react';
import { useData, useNow } from '../../lib/data';
import { formatAgo, formatWhen } from '../../lib/format';
import { useLogged } from '../../lib/feedback';
import { medStatus } from '../../lib/meds';
import type { Medication } from '../../lib/types';
import NumberField from '../NumberField';

export default function MedsLog({ onDone }: { onDone: () => void }) {
  const data = useData();
  const now = useNow(30_000);
  const logged = useLogged();
  const [editing, setEditing] = useState<Partial<Medication> | null>(null);
  const active = data.meds.filter((m) => m.active);

  if (editing) return <MedForm med={editing} onClose={() => setEditing(null)} />;

  return (
    <>
      {active.length === 0 && <p className="hint center">No medications yet. Add one below.</p>}
      <IonList inset>
        {active.map((m) => {
          const s = medStatus(m, data.events, now);
          return (
            <IonItem key={m.id}>
              <IonLabel onClick={() => setEditing(m)}>
                <h2>{m.name}</h2>
                <p>{m.default_dose != null ? `${m.default_dose} ${m.unit ?? ''}` : 'no default dose'}</p>
                <p>
                  {s.last ? `Last ${formatAgo(s.last, now)}` : 'Not given yet'}
                  {m.max_doses_per_24h ? ` · ${s.dosesLast24h}/${m.max_doses_per_24h} in 24h` : ''}
                </p>
                {s.nextAllowed && <IonNote color="warning">Next allowed {formatWhen(s.nextAllowed, now)}</IonNote>}
              </IonLabel>
              <IonButton slot="end" size="default" onClick={async () => {
                const e = await data.add('medicine', {
                  medication_id: m.id, dose_amount: m.default_dose, dose_unit: m.unit,
                });
                if (e) { logged(`${m.name} logged`, e.id); onDone(); }
              }}>Give</IonButton>
            </IonItem>
          );
        })}
      </IonList>
      <p className="hint">“Give” logs the default dose now. Change the dose or time afterwards in History. Tap a name to edit it.</p>
      <IonButton expand="block" fill="outline" onClick={() => setEditing({})}>Add medication</IonButton>
    </>
  );
}

function MedForm({ med, onClose }: { med: Partial<Medication>; onClose: () => void }) {
  const { saveMedication } = useData();
  const [name, setName] = useState(med.name ?? '');
  const [dose, setDose] = useState<number | null>(med.default_dose ?? null);
  const [unit, setUnit] = useState(med.unit ?? 'ml');
  const [minHours, setMinHours] = useState<number | null>(med.min_interval_hours ?? null);
  const [max, setMax] = useState<number | null>(med.max_doses_per_24h ?? null);

  async function save(active = true) {
    if (!name.trim()) return;
    const ok = await saveMedication({
      ...(med.id ? { id: med.id } : {}), name: name.trim(), default_dose: dose, unit: unit.trim() || null,
      min_interval_hours: minHours, max_doses_per_24h: max != null ? Math.round(max) : null, active,
    });
    if (ok) onClose();
  }

  return (
    <>
      <IonList inset>
        <IonItem>
          <IonInput label="Name" labelPlacement="stacked" value={name} onIonInput={(e) => setName(e.detail.value ?? '')} />
        </IonItem>
        <NumberField label="Default dose" value={dose} onChange={setDose} />
        <IonItem>
          <IonInput label="Unit (ml, mg, drops, tablet…)" labelPlacement="stacked" value={unit}
            onIonInput={(e) => setUnit(e.detail.value ?? '')} />
        </IonItem>
        <NumberField label="Minimum hours between doses (optional)" value={minHours} onChange={setMinHours} />
        <NumberField label="Maximum doses per 24 h (optional)" value={max} onChange={setMax} />
      </IonList>
      <p className="hint">Enter limits from your pediatrician or the label. The app only does the arithmetic.</p>
      <IonButton expand="block" size="large" disabled={!name.trim()} onClick={() => save()}>Save</IonButton>
      <IonButton expand="block" fill="clear" onClick={onClose}>Cancel</IonButton>
      {med.id && (
        <IonButton expand="block" fill="clear" color="danger" onClick={() => save(false)}>Remove from list</IonButton>
      )}
    </>
  );
}
