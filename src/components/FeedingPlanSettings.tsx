import { IonButton, IonItem, IonLabel, IonList, IonListHeader, IonNote, IonSelect, IonSelectOption, useIonToast } from '@ionic/react';
import { useEffect, useState } from 'react';
import { dayOfLife, feedEveryMin, readPlan, targetAt, type FeedingPlan } from '../lib/feeding';
import { formatDuration, formatVolume } from '../lib/format';
import { useHousehold } from '../lib/household';
import { supabase } from '../lib/supabase';
import { mlToOz, ozToMl } from '../lib/units';
import NumberField from './NumberField';

/** Settings → Feeding plan (shared by both phones; design doc §8a Q). */
export default function FeedingPlanSettings() {
  const { baby, settings, reload } = useHousehold();
  const [toast] = useIonToast();
  const plan = readPlan(settings.feeding_plan);
  const editable = 'feeding_plan' in settings; // column exists: migration 0011 has run
  const oz = settings.volume_unit === 'oz';
  const toUnit = (ml: number) => (oz ? Math.round(mlToOz(ml) * 10) / 10 : Math.round(ml));
  const fromUnit = (v: number) => (oz ? ozToMl(v) : v);
  const custom = plan.target === 'age' ? null : plan.target;
  const [min, setMin] = useState<number | null>(custom ? toUnit(custom.min_ml) : null);
  const [max, setMax] = useState<number | null>(custom ? toUnit(custom.max_ml) : null);
  const [mode, setMode] = useState<'age' | 'custom'>(custom ? 'custom' : 'age');
  useEffect(() => {
    setMode(custom ? 'custom' : 'age');
    if (custom) { setMin(toUnit(custom.min_ml)); setMax(toUnit(custom.max_ml)); }
  }, [custom?.min_ml, custom?.max_ml, oz]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(next: Partial<FeedingPlan>) {
    if (!supabase) return;
    const { error } = await supabase.from('household_settings').update({ feeding_plan: { ...plan, ...next } }).eq('id', true);
    if (error) void toast({ message: error.message, color: 'danger', duration: 3000 });
    else { await reload(); void toast({ message: 'Saved', duration: 1000 }); }
  }

  const now = new Date();
  const today = targetAt(plan, baby?.birth_date ?? null, now);
  const day = baby?.birth_date ? Math.floor(dayOfLife(baby.birth_date, now)) : null;
  const every = feedEveryMin(plan, baby?.birth_date ?? null, now);
  const range = (t: { min: number; max: number }) => `${formatVolume(t.min, settings)}–${formatVolume(t.max, settings)}`;

  return (
    <IonList inset>
      <IonListHeader><IonLabel>Feeding plan (shared by both phones)</IonLabel></IonListHeader>
      <IonItem>
        <IonSelect label="Target per feed" value={mode} interface="action-sheet" disabled={!editable}
          onIonChange={(e) => {
            setMode(e.detail.value);
            if (e.detail.value === 'age') { if (custom) void save({ target: 'age' }); }
            else if (!custom) { const t = today ?? { min: 75, max: 90 }; setMin(toUnit(t.min)); setMax(toUnit(t.max)); }
          }}>
          <IonSelectOption value="age">By age (lactation handout)</IonSelectOption>
          <IonSelectOption value="custom">Our own numbers</IonSelectOption>
        </IonSelect>
      </IonItem>
      {mode === 'custom' && (
        <>
          <NumberField label="From" value={min} onChange={setMin} unit={oz ? 'oz' : 'ml'} />
          <NumberField label="To" value={max} onChange={setMax} unit={oz ? 'oz' : 'ml'} />
          <IonButton expand="block" fill="outline" className="ion-margin-horizontal" disabled={!editable || !min || !max || max < min}
            onClick={() => void save({ target: { min_ml: Math.round(fromUnit(min!)), max_ml: Math.round(fromUnit(max!)) } })}>Save target</IonButton>
        </>
      )}
      <IonItem>
        <IonSelect label="Count nursing as" value={plan.nursing_ml_per_min} interface="action-sheet" disabled={!editable}
          onIonChange={(e) => void save({ nursing_ml_per_min: Number(e.detail.value) })}>
          {[0, 1, 1.5, 2, 2.1, 2.5, 3, 4, 5, 6].map((r) => <IonSelectOption key={r} value={r}>{r === 2.1 ? '2.1 ml per minute (weighed: 1 oz in 14 min)' : r ? `${r} ml per minute` : 'Nothing (bottles only)'}</IonSelectOption>)}
        </IonSelect>
      </IonItem>
      <IonItem>
        <IonSelect label="Feed every" value={plan.every_min} interface="action-sheet" disabled={!editable}
          onIonChange={(e) => void save({ every_min: e.detail.value === 'age' ? 'age' : Number(e.detail.value) })}>
          <IonSelectOption value="age">By age (daily amount ÷ per feed)</IonSelectOption>
          {[120, 150, 180, 210, 240].map((m) => <IonSelectOption key={m} value={m}>{m % 60 ? `${Math.floor(m / 60)}½ hours` : `${m / 60} hours`}</IonSelectOption>)}
        </IonSelect>
      </IonItem>
      <IonItem lines="none">
        <IonNote className="hint">
          {today ? <>Now: {range(today)} per feed, every {formatDuration(every * 60_000)}{day != null ? ` (day ${day})` : ''}. </> : 'Set the birth date to use the by-age target. '}
          {plan.every_min === 'age' && 'By age, the gap is the handout\'s daily amount spread over feeds of the per-feed size, so it lengthens as he grows (3 h in the first two weeks, about 3½ h from week 4), kept within 2–4 h. '}
          A feed is the bottles and nursing less than 20 minutes apart; its estimated amount is the bottles plus nursing minutes × the rate above.
          A feed at the middle of the target sets the next one a whole interval later; less brings it closer in proportion, more pushes it later, up to what the top of the target allows.
          {!editable && ' To change these, run supabase/migrations/0011_feeding_plan.sql (see docs/SUPABASE_TODO.md).'}
        </IonNote>
      </IonItem>
    </IonList>
  );
}
