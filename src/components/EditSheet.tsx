import {
  IonButton, IonCheckbox, IonInput, IonItem, IonList, IonNote, IonSegment, IonSegmentButton, IonSelect, IonSelectOption, useIonToast,
} from '@ionic/react';
import { useState } from 'react';
import { BOTTLE_BRANDS } from '../lib/bottle';
import { useData } from '../lib/data';
import { META } from '../lib/describe';
import { useHousehold } from '../lib/household';
import { firstSide, manualSegments, sideTotals } from '../lib/nursing';
import type { EventFields, EventRow } from '../lib/types';
import { gToLbOz, lbOzToG } from '../lib/units';
import Chips from './Chips';
import { cap } from '../lib/format';
import { len, temp, vol } from './log/units';
import NotesField from './NotesField';
import NumberField from './NumberField';
import Sheet from './Sheet';
import TimeField from './TimeField';

export default function EditSheet({ event, onClose }: { event: EventRow | null; onClose: () => void }) {
  return (
    <Sheet open={event != null} title={event ? `Edit ${META[event.type].label.toLowerCase()}` : ''} onClose={onClose}>
      {event && <EditForm key={event.id} event={event} onDone={onClose} />}
    </Sheet>
  );
}

const TIMED = new Set(['sleep', 'tummy_time', 'pump', 'nursing']);
const r1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

function EditForm({ event: e, onDone }: { event: EventRow; onDone: () => void }) {
  const { settings } = useHousehold();
  const data = useData();
  const [toast] = useIonToast();
  const v = vol(settings), t = temp(settings), l = len(settings);
  // A bottle is timed if it lasted (start < end) or is the running bottle timer (migration 0007).
  const bottleTimed = e.type === 'bottle' && (e.ended_at ? Date.parse(e.ended_at) > Date.parse(e.started_at) : data.running.bottle?.id === e.id);
  const timed = TIMED.has(e.type) || bottleTimed;
  const running = timed && !e.ended_at;

  const [start, setStart] = useState<Date | null>(new Date(e.started_at));
  const [end, setEnd] = useState<Date | null>(e.ended_at ? new Date(e.ended_at) : null);
  const [notes, setNotes] = useState(e.notes ?? '');
  // type-specific
  const [bottle, setBottle] = useState<number | null>(e.bottle_ml != null ? v.toShow(e.bottle_ml) : null);
  const [contents, setContents] = useState(e.bottle_contents ?? 'breast_milk');
  const [brand, setBrand] = useState<string | null>(e.bottle_brand ?? null);
  const [wet, setWet] = useState(!!e.diaper_wet);
  const [dirty, setDirty] = useState(!!e.diaper_dirty);
  const [color, setColor] = useState<string | null>(e.poop_color);
  const [consistency, setConsistency] = useState<string | null>(e.poop_consistency);
  const [rash, setRash] = useState(!!e.diaper_rash);
  const [pumpSide, setPumpSide] = useState(e.pump_side ?? 'both');
  const [pumpL, setPumpL] = useState<number | null>(e.pump_left_ml != null ? v.toShow(e.pump_left_ml) : null);
  const [pumpR, setPumpR] = useState<number | null>(e.pump_right_ml != null ? v.toShow(e.pump_right_ml) : null);
  const [medId, setMedId] = useState(e.medication_id);
  const [dose, setDose] = useState<number | null>(e.dose_amount);
  const [doseUnit, setDoseUnit] = useState(e.dose_unit ?? '');
  const [tempV, setTempV] = useState<number | null>(e.temp_c != null ? t.toShow(e.temp_c) : null);
  const [method, setMethod] = useState<string | null>(e.temp_method);
  const imperial = settings.weight_unit === 'lb_oz';
  const w = e.weight_g != null ? gToLbOz(e.weight_g) : null;
  const [lb, setLb] = useState<number | null>(w?.lb ?? null);
  const [oz, setOz] = useState<number | null>(w?.oz ?? null);
  const [kg, setKg] = useState<number | null>(e.weight_g != null ? e.weight_g / 1000 : null);
  const [length, setLength] = useState<number | null>(e.length_cm != null ? l.toShow(e.length_cm) : null);
  const [head, setHead] = useState<number | null>(e.head_cm != null ? l.toShow(e.head_cm) : null);
  const segs = e.nursing_segments ?? [];
  const totals = sideTotals(segs);
  const [leftMin, setLeftMin] = useState<number | null>(Math.round(totals.left / 60000));
  const [rightMin, setRightMin] = useState<number | null>(Math.round(totals.right / 60000));

  const badRange = !!start && !!end && end < start;

  async function save() {
    if (!start || badRange) return;
    const f: EventFields = { started_at: start.toISOString(), notes: notes.trim() || null };
    if (!running && (timed || e.type === 'bath')) f.ended_at = end ? end.toISOString() : null;
    else if (e.type === 'bottle' && !running) f.ended_at = f.started_at; // an untimed bottle stays an instant
    switch (e.type) {
      case 'bottle':
        Object.assign(f, { bottle_ml: bottle != null ? v.toStore(bottle) : null, bottle_contents: contents, ...(data.features.bottleBrand ? { bottle_brand: brand } : {}) });
        break;
      case 'diaper':
        Object.assign(f, { diaper_wet: wet, diaper_dirty: dirty, poop_color: dirty ? color : null,
          poop_consistency: dirty ? consistency : null, diaper_rash: rash || null });
        break;
      case 'pump':
        Object.assign(f, { pump_side: pumpSide,
          pump_left_ml: pumpSide !== 'right' && pumpL != null ? v.toStore(pumpL) : null,
          pump_right_ml: pumpSide !== 'left' && pumpR != null ? v.toStore(pumpR) : null });
        break;
      case 'medicine':
        Object.assign(f, { medication_id: medId, dose_amount: dose, dose_unit: doseUnit.trim() || null });
        break;
      case 'temperature':
        Object.assign(f, { temp_c: tempV != null ? Math.round(t.toStore(tempV) * 100) / 100 : null, temp_method: method });
        break;
      case 'growth':
        Object.assign(f, {
          weight_g: r1(imperial ? (lb != null || oz != null ? lbOzToG(lb ?? 0, oz ?? 0) : null) : (kg != null ? kg * 1000 : null)),
          length_cm: r1(length != null ? l.toStore(length) : null),
          head_cm: r1(head != null ? l.toStore(head) : null),
        });
        break;
    }
    if (e.type === 'nursing' && !running) {
      const origL = Math.round(totals.left / 60000), origR = Math.round(totals.right / 60000);
      const changed = (leftMin ?? 0) !== origL || (rightMin ?? 0) !== origR || start.getTime() !== new Date(e.started_at).getTime();
      if (changed) {
        const newSegs = manualSegments(start, leftMin ?? 0, rightMin ?? 0, firstSide(segs) ?? 'left');
        if (!(await data.replaceNursingSegments(e.id, newSegs))) return;
        f.ended_at = (newSegs.at(-1)?.ended_at ?? start).toISOString();
      }
    }
    if (await data.update(e.id, f)) onDone();
  }

  async function del() {
    if (await data.remove(e.id)) {
      void toast({ message: `${META[e.type].label} deleted`, duration: 5000,
        buttons: [{ text: 'Undo', handler: () => void data.restore(e.id) }] });
      onDone();
    }
  }

  return (
    <>
      {running && <IonNote className="hint">This timer is still running. Stop it from the Home screen.</IonNote>}
      <IonList inset>
        <TimeField label={timed ? 'Start' : 'Time'} value={start} onChange={setStart} />
        {!running && (timed && e.type !== 'nursing') && <TimeField label="End" value={end} onChange={setEnd} />}

        {e.type === 'nursing' && !running && (
          <>
            <NumberField label="Left" unit="min" value={leftMin} onChange={setLeftMin} />
            <NumberField label="Right" unit="min" value={rightMin} onChange={setRightMin} />
          </>
        )}
        {e.type === 'bottle' && (
          <>
            <NumberField label="Amount" unit={v.unit} value={bottle} onChange={setBottle} />
            <IonItem>
              <IonSegment value={contents} onIonChange={(x) => setContents(x.detail.value as typeof contents)}>
                <IonSegmentButton value="breast_milk">Breast milk</IonSegmentButton>
                <IonSegmentButton value="formula">Formula</IonSegmentButton>
                <IonSegmentButton value="mixed">Mixed</IonSegmentButton>
              </IonSegment>
            </IonItem>
            {data.features.bottleBrand && (
              <IonItem>
                <IonSelect label="Bottle" labelPlacement="stacked" interface="action-sheet" placeholder="Not set"
                  value={brand ?? ''} onIonChange={(x) => setBrand(x.detail.value || null)}>
                  {BOTTLE_BRANDS.map((b) => <IonSelectOption key={b} value={b}>{b}</IonSelectOption>)}
                </IonSelect>
              </IonItem>
            )}
          </>
        )}
        {e.type === 'diaper' && (
          <>
            <IonItem><IonCheckbox checked={wet} onIonChange={(x) => setWet(x.detail.checked)} labelPlacement="end">Wet</IonCheckbox></IonItem>
            <IonItem><IonCheckbox checked={dirty} onIonChange={(x) => setDirty(x.detail.checked)} labelPlacement="end">Dirty</IonCheckbox></IonItem>
            {dirty && (
              <>
                <IonItem><Chips options={['yellow', 'green', 'brown', 'black', 'red', 'white'].map((c) => ({ value: c, label: cap(c) }))} value={color} onChange={setColor} /></IonItem>
                <IonItem><Chips options={['watery', 'seedy', 'soft', 'formed', 'hard'].map((c) => ({ value: c, label: cap(c) }))} value={consistency} onChange={setConsistency} /></IonItem>
              </>
            )}
            <IonItem><IonCheckbox checked={rash} onIonChange={(x) => setRash(x.detail.checked)} labelPlacement="end">Diaper rash</IonCheckbox></IonItem>
          </>
        )}
        {e.type === 'pump' && (
          <>
            <IonItem>
              <IonSegment value={pumpSide} onIonChange={(x) => setPumpSide(x.detail.value as typeof pumpSide)}>
                <IonSegmentButton value="left">Left</IonSegmentButton>
                <IonSegmentButton value="right">Right</IonSegmentButton>
                <IonSegmentButton value="both">Both</IonSegmentButton>
              </IonSegment>
            </IonItem>
            {pumpSide !== 'right' && <NumberField label="Left amount" unit={v.unit} value={pumpL} onChange={setPumpL} />}
            {pumpSide !== 'left' && <NumberField label="Right amount" unit={v.unit} value={pumpR} onChange={setPumpR} />}
          </>
        )}
        {e.type === 'medicine' && (
          <>
            <IonItem>
              <IonSelect label="Medication" value={medId} onIonChange={(x) => setMedId(x.detail.value)}>
                {data.meds.map((m) => <IonSelectOption key={m.id} value={m.id}>{m.name}</IonSelectOption>)}
              </IonSelect>
            </IonItem>
            <NumberField label="Dose" value={dose} onChange={setDose} />
            <IonItem>
              <IonInput label="Unit" labelPlacement="stacked" value={doseUnit} onIonInput={(x) => setDoseUnit(x.detail.value ?? '')} />
            </IonItem>
          </>
        )}
        {e.type === 'temperature' && (
          <>
            <NumberField label="Temperature" unit={t.unit} value={tempV} onChange={setTempV} />
            <IonItem><Chips options={['rectal', 'axillary', 'temporal', 'ear', 'oral'].map((m) => ({ value: m, label: cap(m) }))} value={method} onChange={setMethod} /></IonItem>
          </>
        )}
        {e.type === 'growth' && (
          <>
            {imperial ? (
              <>
                <NumberField label="Weight" unit="lb" value={lb} onChange={setLb} />
                <NumberField label="+" unit="oz" value={oz} onChange={setOz} />
              </>
            ) : <NumberField label="Weight" unit="kg" value={kg} onChange={setKg} />}
            <NumberField label="Length" unit={l.unit} value={length} onChange={setLength} />
            <NumberField label="Head circumference" unit={l.unit} value={head} onChange={setHead} />
          </>
        )}
        <NotesField value={notes} onChange={setNotes} />
      </IonList>
      {badRange && <IonNote color="danger" className="hint">End is before start.</IonNote>}
      <IonButton expand="block" size="large" disabled={!start || badRange} onClick={save}>Save changes</IonButton>
      <IonButton expand="block" fill="clear" color="danger" onClick={del}>Delete</IonButton>
    </>
  );
}
