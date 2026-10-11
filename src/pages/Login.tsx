import {
  IonButton, IonContent, IonInput, IonItem, IonList, IonNote, IonPage, IonSpinner, IonText,
} from '@ionic/react';
import { useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Email sign-in. Supabase emails a 6-digit code (and a link). Public sign-up
 * is disabled, so only the two accounts created in the dashboard can sign in.
 */
export default function Login() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: window.location.origin + import.meta.env.BASE_URL,
      },
    });
    setBusy(false);
    if (error) setError(friendly(error.message));
    else setStep('code');
  }

  async function verify() {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) setError(friendly(error.message));
  }

  return (
    <IonPage>
      <IonContent className="ion-padding">
        <div className="login">
          <div className="login-logo">🌙</div>
          <h1>kidTracker</h1>
          {step === 'email' ? (
            <>
              <IonList inset>
                <IonItem>
                  <IonInput
                    label="Email" labelPlacement="stacked" type="email" inputmode="email"
                    autocomplete="email" value={email}
                    onIonInput={(e) => setEmail(e.detail.value ?? '')}
                    onKeyDown={(e) => e.key === 'Enter' && email && void sendCode()}
                  />
                </IonItem>
              </IonList>
              <IonButton expand="block" size="large" disabled={!email || busy} onClick={sendCode}>
                {busy ? <IonSpinner name="dots" /> : 'Email me a sign-in code'}
              </IonButton>
            </>
          ) : (
            <>
              <IonText color="medium">
                <p>Enter the 6-digit code sent to <b>{email}</b>, or tap the link in that email.</p>
              </IonText>
              <IonList inset>
                <IonItem>
                  <IonInput
                    label="Code" labelPlacement="stacked" inputmode="numeric" autocomplete="one-time-code"
                    maxlength={10} value={code}
                    onIonInput={(e) => setCode(e.detail.value ?? '')}
                    onKeyDown={(e) => e.key === 'Enter' && code && void verify()}
                  />
                </IonItem>
              </IonList>
              <IonButton expand="block" size="large" disabled={code.trim().length < 6 || busy} onClick={verify}>
                {busy ? <IonSpinner name="dots" /> : 'Sign in'}
              </IonButton>
              <IonButton expand="block" fill="clear" onClick={() => { setStep('email'); setCode(''); }}>
                Use a different email
              </IonButton>
            </>
          )}
          {error && <IonNote color="danger" className="login-error">{error}</IonNote>}
        </div>
      </IonContent>
    </IonPage>
  );
}

function friendly(msg: string): string {
  if (/signups not allowed|user not found/i.test(msg)) {
    return 'This email is not set up for kidTracker. Ask the account owner to add it in Supabase.';
  }
  if (/expired|invalid/i.test(msg)) return 'That code is wrong or has expired. Request a new one.';
  if (/rate limit|too many/i.test(msg)) return 'Too many emails requested. Wait a few minutes and try again.';
  return msg;
}
