import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, useIonToast } from '@ionic/react';
import { useHousehold } from '../lib/household';
import { ageLabel } from '../lib/units';

interface Tile { key: string; emoji: string; label: string }

const PRIMARY: Tile[] = [
  { key: 'sleep', emoji: '😴', label: 'Sleep' },
  { key: 'nursing', emoji: '🤱', label: 'Nurse' },
  { key: 'bottle', emoji: '🍼', label: 'Bottle' },
  { key: 'diaper', emoji: '🧷', label: 'Diaper' },
  { key: 'pump', emoji: '🥛', label: 'Pump' },
  { key: 'medicine', emoji: '💊', label: 'Meds' },
];
const SECONDARY: Tile[] = [
  { key: 'temperature', emoji: '🌡️', label: 'Temp' },
  { key: 'growth', emoji: '📏', label: 'Growth' },
  { key: 'tummy_time', emoji: '🧸', label: 'Tummy' },
  { key: 'bath', emoji: '🛁', label: 'Bath' },
];

export default function Home() {
  const { baby } = useHousehold();
  const [toast] = useIonToast();
  const soon = (t: Tile) =>
    toast({ message: `${t.label} logging arrives in the next build.`, duration: 1500, position: 'bottom' });

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>
            {baby?.name}
            {baby?.birth_date && <span className="subtitle"> · {ageLabel(baby.birth_date)}</span>}
          </IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <div className="tile-grid">
          {PRIMARY.map((t) => (
            <button key={t.key} className="tile" onClick={() => soon(t)}>
              <span className="tile-emoji">{t.emoji}</span>
              <span className="tile-label">{t.label}</span>
              <span className="tile-sub">—</span>
            </button>
          ))}
        </div>
        <div className="tile-grid tile-grid-small">
          {SECONDARY.map((t) => (
            <button key={t.key} className="tile tile-small" onClick={() => soon(t)}>
              <span className="tile-emoji">{t.emoji}</span>
              <span className="tile-label">{t.label}</span>
            </button>
          ))}
        </div>
        <h2 className="section-title">Today</h2>
        <p className="empty">Nothing logged yet.</p>
      </IonContent>
    </IonPage>
  );
}
