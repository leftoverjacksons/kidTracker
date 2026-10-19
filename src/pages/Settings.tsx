import {
  IonButton, IonContent, IonHeader, IonInput, IonInputPasswordToggle, IonItem, IonLabel, IonList, IonListHeader, IonNote,
  IonPage, IonSelect, IonSelectOption, IonTitle, IonToolbar, useIonToast,
} from '@ionic/react';
import { useEffect, useState } from 'react';
import { useHousehold } from '../lib/household';
import { pumpEveryMin, setPumpEveryMin } from '../lib/pump';
import { supabase } from '../lib/supabase';
import type { HouseholdSettings } from '../lib/types';

export default function Settings() {
  const { me, baby, settings, session, reload } = useHousehold();
  const [toast] = useIonToast();
  const [displayName, setDisplayName] = useState(me?.display_name ?? '');
  const [babyName, setBabyName] = useState(baby?.name ?? '');
  const [birthDate, setBirthDate] = useState(baby?.birth_date ?? '');
  const [newPassword, setNewPassword] = useState('');
  const [pumpEvery, setPumpEvery] = useState<number | null>(pumpEveryMin);

  useEffect(() => setDisplayName(me?.display_name ?? ''), [me]);
  useEffect(() => { setBabyName(baby?.name ?? ''); setBirthDate(baby?.birth_date ?? ''); }, [baby]);

  async function run(p: PromiseLike<{ error: { message: string } | null }>) {
    const { error } = await p;
    if (error) toast({ message: error.message, color: 'danger', duration: 3000 });
    else { await reload(); toast({ message: 'Saved', duration: 1000 }); }
  }

  const saveName = () => supabase && me && displayName.trim() && displayName !== me.display_name &&
    run(supabase.from('caregivers').update({ display_name: displayName.trim() }).eq('id', me.id));

  const saveBaby = () => supabase && baby && babyName.trim() &&
    (babyName !== baby.name || (birthDate || null) !== baby.birth_date) &&
    run(supabase.from('babies').update({ name: babyName.trim(), birth_date: birthDate || null }).eq('id', baby.id));

  async function changePassword() {
    if (!supabase || newPassword.length < 8) return;
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) toast({ message: error.message, color: 'danger', duration: 3000 });
    else { setNewPassword(''); toast({ message: 'Password changed', duration: 1500 }); }
  }

  const setUnit = <K extends keyof HouseholdSettings>(k: K, v: HouseholdSettings[K]) =>
    supabase && v !== settings[k] &&
    run(supabase.from('household_settings').update({ [k]: v }).eq('id', true));

  return (
    <IonPage>
      <IonHeader><IonToolbar><IonTitle>Settings</IonTitle></IonToolbar></IonHeader>
      <IonContent>
        <IonList inset>
          <IonListHeader><IonLabel>You</IonLabel></IonListHeader>
          <IonItem>
            <IonInput label="Your name (shown on entries)" labelPlacement="stacked" value={displayName}
              onIonInput={(e) => setDisplayName(e.detail.value ?? '')} onIonBlur={saveName} />
          </IonItem>
          <IonItem><IonLabel color="medium">{session?.user.email}</IonLabel></IonItem>
          <IonItem>
            <IonInput label="New password (8+ characters)" labelPlacement="stacked" type="password"
              autocomplete="new-password" value={newPassword}
              onIonInput={(e) => setNewPassword(e.detail.value ?? '')}>
              <IonInputPasswordToggle slot="end" />
            </IonInput>
            <IonButton slot="end" fill="clear" disabled={newPassword.length < 8} onClick={changePassword}>
              Change
            </IonButton>
          </IonItem>
        </IonList>

        <IonList inset>
          <IonListHeader><IonLabel>Baby</IonLabel></IonListHeader>
          <IonItem>
            <IonInput label="Name" labelPlacement="stacked" value={babyName}
              onIonInput={(e) => setBabyName(e.detail.value ?? '')} onIonBlur={saveBaby} />
          </IonItem>
          <IonItem>
            <IonInput label="Birth date" labelPlacement="stacked" type="date" value={birthDate}
              onIonInput={(e) => setBirthDate(e.detail.value ?? '')} onIonBlur={saveBaby} />
          </IonItem>
          <IonItem>
            <IonSelect label="Sex (for WHO growth percentiles)" value={baby?.sex ?? null} interface="action-sheet"
              placeholder="Not set"
              onIonChange={(e) => supabase && baby && e.detail.value !== (baby.sex ?? null) &&
                run(supabase.from('babies').update({ sex: e.detail.value }).eq('id', baby.id))}>
              <IonSelectOption value="female">Female</IonSelectOption>
              <IonSelectOption value="male">Male</IonSelectOption>
            </IonSelect>
          </IonItem>
        </IonList>

        <IonList inset>
          <IonListHeader><IonLabel>Units (shared by both phones)</IonLabel></IonListHeader>
          <IonItem>
            <IonSelect label="Volume" value={settings.volume_unit} interface="action-sheet"
              onIonChange={(e) => setUnit('volume_unit', e.detail.value)}>
              <IonSelectOption value="oz">oz</IonSelectOption>
              <IonSelectOption value="ml">ml</IonSelectOption>
            </IonSelect>
          </IonItem>
          <IonItem>
            <IonSelect label="Temperature" value={settings.temp_unit} interface="action-sheet"
              onIonChange={(e) => setUnit('temp_unit', e.detail.value)}>
              <IonSelectOption value="F">°F</IonSelectOption>
              <IonSelectOption value="C">°C</IonSelectOption>
            </IonSelect>
          </IonItem>
          <IonItem>
            <IonSelect label="Weight" value={settings.weight_unit} interface="action-sheet"
              onIonChange={(e) => setUnit('weight_unit', e.detail.value)}>
              <IonSelectOption value="lb_oz">lb + oz</IonSelectOption>
              <IonSelectOption value="kg">kg</IonSelectOption>
            </IonSelect>
          </IonItem>
          <IonItem>
            <IonSelect label="Length" value={settings.length_unit} interface="action-sheet"
              onIonChange={(e) => setUnit('length_unit', e.detail.value)}>
              <IonSelectOption value="in">in</IonSelectOption>
              <IonSelectOption value="cm">cm</IonSelectOption>
            </IonSelect>
          </IonItem>
        </IonList>

        <IonList inset>
          <IonListHeader><IonLabel>Pumping reminder (this phone)</IonLabel></IonListHeader>
          <IonItem>
            <IonSelect label="Remind me to pump" value={String(pumpEvery ?? 'off')} interface="action-sheet"
              onIonChange={(e) => { const v = e.detail.value === 'off' ? null : Number(e.detail.value); setPumpEveryMin(v); setPumpEvery(v); }}>
              <IonSelectOption value="120">Every 2 h (12 a day)</IonSelectOption>
              <IonSelectOption value="150">Every 2½ h (about 10 a day)</IonSelectOption>
              <IonSelectOption value="180">Every 3 h (8 a day)</IonSelectOption>
              <IonSelectOption value="off">Off</IonSelectOption>
            </IonSelect>
          </IonItem>
          <IonItem lines="none"><IonNote className="hint">Counted from the start of the last 15+ minute session. Shows on Home while the app is open; it can't buzz the phone yet.</IonNote></IonItem>
        </IonList>

        <div className="ion-padding">
          <IonButton expand="block" color="medium" fill="outline" onClick={() => supabase?.auth.signOut()}>
            Sign out
          </IonButton>
          <IonNote className="version">Version {__APP_VERSION__}</IonNote>
        </div>
      </IonContent>
    </IonPage>
  );
}
