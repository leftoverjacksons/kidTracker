import {
  IonApp, IonButton, IonContent, IonIcon, IonLabel, IonPage, IonRouterOutlet, IonSpinner,
  IonTabBar, IonTabButton, IonTabs, setupIonicReact, useIonToast,
} from '@ionic/react';
import { IonReactHashRouter } from '@ionic/react-router';
import { barChart, home, list, settings as settingsIcon } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { Redirect, Route } from 'react-router-dom';
import { DataProvider } from './lib/data';
import { HouseholdProvider, useHousehold } from './lib/household';
import { supabase } from './lib/supabase';
import History from './pages/History';
import Home from './pages/Home';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import PrintReport from './pages/PrintReport';
import Reports from './pages/Reports';
import Settings from './pages/Settings';

setupIonicReact();

function Tabs() {
  return (
    <IonReactHashRouter>
      <IonTabs>
        <IonRouterOutlet>
          <Route exact path="/home" component={Home} />
          <Route exact path="/history" component={History} />
          <Route exact path="/reports" component={Reports} />
          <Route exact path="/settings" component={Settings} />
          <Route exact path="/"><Redirect to="/home" /></Route>
        </IonRouterOutlet>
        <IonTabBar slot="bottom">
          <IonTabButton tab="home" href="/home"><IonIcon icon={home} /><IonLabel>Home</IonLabel></IonTabButton>
          <IonTabButton tab="history" href="/history"><IonIcon icon={list} /><IonLabel>History</IonLabel></IonTabButton>
          <IonTabButton tab="reports" href="/reports"><IonIcon icon={barChart} /><IonLabel>Reports</IonLabel></IonTabButton>
          <IonTabButton tab="settings" href="/settings"><IonIcon icon={settingsIcon} /><IonLabel>Settings</IonLabel></IonTabButton>
        </IonTabBar>
      </IonTabs>
    </IonReactHashRouter>
  );
}

function Gate() {
  const { loading, session, notAllowed, unreachable, baby, reload } = useHousehold();
  if (loading) return <Centered><IonSpinner /></Centered>;
  if (!session) return <Login />;
  if (unreachable) {
    return (
      <Centered>
        <p><b>Can't reach the LakTrak database.</b></p>
        <p className="hint">Check the phone's internet connection (try Wi-Fi off/on), then retry. Your data is safe on the server.</p>
        <p className="hint">Details: {unreachable}</p>
        <IonButton onClick={() => void reload()}>Retry</IonButton>
      </Centered>
    );
  }
  if (notAllowed) {
    return (
      <Centered>
        <p>This account is signed in but is not on the caregiver list.</p>
        <IonButton onClick={() => supabase?.auth.signOut()}>Sign out</IonButton>
      </Centered>
    );
  }
  if (!baby) return <Onboarding />;
  return <SignedIn />;
}

function SignedIn() {
  const [toast] = useIonToast();
  const hash = useHash();
  const print = /^#\/print/.test(hash);
  const days = Number(new URLSearchParams(hash.split('?')[1] ?? '').get('days')) || 14;
  return (
    <DataProvider onError={(message) => void toast({ message, color: 'danger', duration: 4000 })}>
      {print ? <PrintReport days={days} /> : <Tabs />}
    </DataProvider>
  );
}

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <IonPage><IonContent className="ion-padding"><div className="centered">{children}</div></IonContent></IonPage>;
}

export default function App() {
  return (
    <IonApp>
      {supabase ? (
        <HouseholdProvider><Gate /></HouseholdProvider>
      ) : (
        <Centered>
          <h2>Not configured</h2>
          <p>This build has no Supabase settings. See SETUP.md, step 4.</p>
        </Centered>
      )}
    </IonApp>
  );
}
