import {
  IonButton, IonContent, IonInput, IonInputPasswordToggle, IonItem, IonList, IonNote, IonPage, IonSpinner,
} from '@ionic/react';
import { useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Email + password sign-in. Accounts are created in the Supabase dashboard
 * (public sign-up is disabled); each phone signs in once and stays signed in.
 */
export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = email.trim() !== '' && password !== '' && !busy;

  async function signIn() {
    if (!supabase || !ready) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(friendly(error.message));
  }

  return (
    <IonPage>
      <IonContent className="ion-padding">
        <form className="login" onSubmit={(e) => { e.preventDefault(); void signIn(); }}>
          <div className="login-logo">🌙</div>
          <h1>LakTrak</h1>
          <IonList inset>
            <IonItem>
              <IonInput
                label="Email" labelPlacement="stacked" type="email" inputmode="email"
                autocomplete="email" value={email}
                onIonInput={(e) => setEmail(e.detail.value ?? '')}
              />
            </IonItem>
            <IonItem>
              <IonInput
                label="Password" labelPlacement="stacked" type="password"
                autocomplete="current-password" value={password}
                onIonInput={(e) => setPassword(e.detail.value ?? '')}
              >
                <IonInputPasswordToggle slot="end" />
              </IonInput>
            </IonItem>
          </IonList>
          <IonButton type="submit" expand="block" size="large" disabled={!ready}>
            {busy ? <IonSpinner name="dots" /> : 'Sign in'}
          </IonButton>
          {error && <IonNote color="danger" className="login-error">{error}</IonNote>}
        </form>
      </IonContent>
    </IonPage>
  );
}

function friendly(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Wait a few minutes and try again.';
  return msg;
}
