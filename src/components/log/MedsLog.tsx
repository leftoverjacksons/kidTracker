import { IonButton, IonInput, IonItem, IonLabel, IonList, IonListHeader, IonSegment, IonSegmentButton, IonSelect, IonSelectOption } from '@ionic/react';
import { useState } from 'react';
import { useData, useNow } from '../../lib/data';
import { formatAgo, formatDuration, formatWhen } from '../../lib/format';
import { useLogged } from '../../lib/feedback';
import { isMom, MED_PRESETS, medStatus } from '../../lib/meds';
import type { Medication } from '../../lib/types';
import NumberField from '../NumberField';
import TimeField from '../TimeField';

/**
 * Medicines for the baby and for Mom (design doc §8a F). Each has its own minimum
 * interval; its button stays greyed out until that time has passed.
 */
export default function MedsLog({ onDone }: { onDone: () => void }) {
  const data = useData();
  const [editing, setEditing] = useState<Partial<Medication> | null>(null);
  const [past, setPast] = useState(false);
  const active = data.meds.filter((m) => m.active);
  const groups = [
    { title: 'Mom', meds: active.filter(isMom) },
    { title: 'Baby', meds: active.filter((m) => !isMom(m)) },
  ].filter((g) => g.meds.length);

  if (editing) return <MedForm med={editing} onClose={() => setEditing(null)} />;
  if (past) return <PastDose meds={active} onClose={() => setPast(false)} onDone={onDone} />;

  return (
    <>
      {active.length === 0 && <p className="hint center">No medications yet. Add one below.</p>}
      {groups.map((g) => (
        <IonList inset key={g.title}>
          {groups.length > 1 && <IonListHeader><IonLabel>{g.title}</IonLabel></IonListHeader>}
          {g.meds.map((m) => <MedRow key={m.id} med={m} onEdit={() => setEditing(m)} onDone={onDone} />)}
        </IonList>
      ))}
      <p className="hint">A button is greyed out until the minimum time since the last dose has passed. Tap a name to edit it.</p>
      {active.length > 0 && <IonButton expand="block" fill="outline" onClick={() => setPast(true)}>Log a dose at another time</IonButton>}
      <IonButton expand="block" fill="clear" onClick={() => setEditing({})}>Add medication</IonButton>
    </>
  );
}

function MedRow({ med: m, onEdit, onDone }: { med: Medication; onEdit: () => void; onDone: () => void }) {
  const data = useData();
  const now = useNow(30_000);
  const logged = useLogged();
  const s = medStatus(m, data.events, now);
  const lastBy = s.last ? data.events.find((e) => e.type === 'medicine' && e.medication_id === m.id)?.created_by : null;
  const waiting = s.nextAllowed != null;
  return (
    <IonItem className={`med-row ${waiting ? 'med-wait' : 'med-ready'}`} data-med={m.name}>
      <IonLabel onClick={onEdit}>
        <h2>{m.name}</h2>
        <p>
          {m.default_dose != null ? `${m.default_dose} ${m.unit ?? ''} · ` : ''}
          {s.last ? `last ${formatAgo(s.last, now)}${lastBy && data.names[lastBy] ? ` (${data.names[lastBy]})` : ''}` : 'not taken yet'}
          {m.max_doses_per_24h ? ` · ${s.dosesLast24h}/${m.max_doses_per_24h} in 24 h` : ''}
        </p>
        <p className="med-status">
          {waiting
            ? <>Next at <b>{formatWhen(s.nextAllowed!, now)}</b> · in {formatDuration(s.nextAllowed!.getTime() - now.getTime())}</>
            : m.min_interval_hours || m.max_doses_per_24h ? 'Available now' : ''}
        </p>
      </IonLabel>
      <IonButton slot="end" size="default" disabled={waiting} onClick={async () => {
        const e = await data.add('medicine', { medication_id: m.id, dose_amount: m.default_dose, dose_unit: m.unit });
        if (e) { logged(`${m.name} logged`, e.id); onDone(); }
      }}>{isMom(m) ? 'Take' : 'Give'}</IonButton>
    </IonItem>
  );
}

/** Record a dose taken earlier (e.g. forgot to log it). Not limited by the interval. */
function PastDose({ meds, onClose, onDone }: { meds: Medication[]; onClose: () => void; onDone: () => void }) {
  const data = useData();
  const logged = useLogged();
  const [id, setId] = useState<string | null>(meds[0]?.id ?? null);
  const [at, setAt] = useState<Date | null>(new Date());
  const med = meds.find((m) => m.id === id);
  const valid = med && at && at <= new Date();
  return (
    <>
      <IonList inset>
        <IonItem>
          <IonSelect label="Medication" labelPlacement="stacked" interface="popover" value={id} onIonChange={(e) => setId(e.detail.value)}>
            {meds.map((m) => <IonSelectOption key={m.id} value={m.id}>{isMom(m) ? `${m.name} (Mom)` : m.name}</IonSelectOption>)}
          </IonSelect>
        </IonItem>
        <TimeField label="Taken at" value={at} onChange={setAt} />
      </IonList>
      <IonButton expand="block" size="large" disabled={!valid} onClick={async () => {
        if (!med || !at) return;
        const e = await data.add('medicine', { medication_id: med.id, dose_amount: med.default_dose, dose_unit: med.unit, started_at: at.toISOString() });
        if (e) { logged(`${med.name} logged`, e.id); onDone(); }
      }}>Save</IonButton>
      <IonButton expand="block" fill="clear" onClick={onClose}>Cancel</IonButton>
    </>
  );
}

function MedForm({ med, onClose }: { med: Partial<Medication>; onClose: () => void }) {
  const { saveMedication } = useData();
  const [name, setName] = useState(med.name ?? '');
  const [who, setWho] = useState<'baby' | 'mom'>(med.for_whom ?? 'mom');
  const [dose, setDose] = useState<number | null>(med.default_dose ?? null);
  const [unit, setUnit] = useState(med.unit ?? 'mg');
  const [minHours, setMinHours] = useState<number | null>(med.min_interval_hours ?? null);
  const [max, setMax] = useState<number | null>(med.max_doses_per_24h ?? null);

  async function save(active = true) {
    if (!name.trim()) return;
    const ok = await saveMedication({
      ...(med.id ? { id: med.id } : {}), name: name.trim(), default_dose: dose, unit: unit.trim() || null,
      min_interval_hours: minHours, max_doses_per_24h: max != null ? Math.round(max) : null, active,
      // Only sent for Mom's medicines, so baby medicines still save before migration 0005 has run.
      ...(who === 'mom' || med.for_whom ? { for_whom: who } : {}),
    });
    if (ok) onClose();
  }

  return (
    <>
      <IonSegment value={who} onIonChange={(e) => setWho(e.detail.value as 'baby' | 'mom')}>
        <IonSegmentButton value="mom">For Mom</IonSegmentButton>
        <IonSegmentButton value="baby">For baby</IonSegmentButton>
      </IonSegment>
      <IonList inset>
        {!med.id && (
          <IonItem>
            <IonSelect label="Choose a common one (optional)" labelPlacement="stacked" interface="popover" placeholder="Pick or type below"
              onIonChange={(e) => {
                const p = MED_PRESETS.find((x) => x.name === e.detail.value);
                if (!p) return;
                setName(p.name); setWho(p.for_whom); setUnit(p.unit); setMinHours(p.min_interval_hours);
              }}>
              {MED_PRESETS.map((p) => <IonSelectOption key={p.name} value={p.name}>{p.name}</IonSelectOption>)}
            </IonSelect>
          </IonItem>
        )}
        <IonItem>
          <IonInput label="Name" labelPlacement="stacked" value={name} onIonInput={(e) => setName(e.detail.value ?? '')} />
        </IonItem>
        <NumberField label="Default dose" value={dose} onChange={setDose} />
        <IonItem>
          <IonInput label="Unit (mg, ml, drops, tablet…)" labelPlacement="stacked" value={unit}
            onIonInput={(e) => setUnit(e.detail.value ?? '')} />
        </IonItem>
        <NumberField label="Minimum hours between doses" value={minHours} onChange={setMinHours} />
        <NumberField label="Maximum doses per 24 h (optional)" value={max} onChange={setMax} />
      </IonList>
      <p className="hint">Use the numbers from the prescription or label. The app only does the arithmetic.</p>
      <IonButton expand="block" size="large" disabled={!name.trim()} onClick={() => save()}>Save</IonButton>
      <IonButton expand="block" fill="clear" onClick={onClose}>Cancel</IonButton>
      {med.id && (
        <IonButton expand="block" fill="clear" color="danger" onClick={() => save(false)}>Remove from list</IonButton>
      )}
    </>
  );
}
