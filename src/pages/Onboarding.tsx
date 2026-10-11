import { IonButton, IonContent, IonHeader, IonInput, IonItem, IonList, IonNote, IonPage, IonTitle, IonToolbar } from '@ionic/react';
import { useState } from 'react';
import { useHousehold } from '../lib/household';
import { supabase } from '../lib/supabase';

/** First run: neither caregiver has added the baby yet. */
export default function Onboarding() {
  const { reload } = useHousehold();
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.from('babies').insert({ name: name.trim(), birth_date: birthDate || null });
    setBusy(false);
    if (error) setError(error.message);
    else await reload();
  }

  return (
    <IonPage>
      <IonHeader><IonToolbar><IonTitle>Welcome</IonTitle></IonToolbar></IonHeader>
      <IonContent className="ion-padding">
        <p>Add your baby to get started. Only one of you needs to do this; it appears on both phones.</p>
        <IonList inset>
          <IonItem>
            <IonInput label="Name" labelPlacement="stacked" value={name} onIonInput={(e) => setName(e.detail.value ?? '')} />
          </IonItem>
          <IonItem>
            <IonInput label="Birth date" labelPlacement="stacked" type="date" value={birthDate}
              onIonInput={(e) => setBirthDate(e.detail.value ?? '')} />
          </IonItem>
        </IonList>
        <IonButton expand="block" size="large" disabled={!name.trim() || busy} onClick={save}>Save</IonButton>
        {error && <IonNote color="danger">{error}</IonNote>}
      </IonContent>
    </IonPage>
  );
}
