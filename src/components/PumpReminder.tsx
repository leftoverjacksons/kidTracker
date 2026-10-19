import { IonButton } from '@ionic/react';
import { useState } from 'react';
import { useData, useNow } from '../lib/data';
import { formatDuration } from '../lib/format';
import { PUMP_TARGET, pumpCounts, pumpDue, pumpEveryMin } from '../lib/pump';

const SNOOZE_KEY = 'kt.pumpSnooze';
const SIDE = { left: 'left side', right: 'right side', both: 'both sides' } as const;

/** "Time to pump" card on Home once the next session is due (design doc §8a I). */
export default function PumpReminder({ onStart }: { onStart: () => void }) {
  const data = useData();
  const now = useNow(30_000);
  // Snooze is per phone and tied to the last session, so a new session clears it.
  const [snooze, setSnooze] = useState<{ last: string; until: number } | null>(() => {
    try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? 'null'); } catch { return null; }
  });
  const d = pumpDue(data.events, now, pumpEveryMin());
  if (!d || d.due > now) return null;
  if (snooze && snooze.last === d.last.toISOString() && snooze.until > now.getTime()) return null;
  const c = pumpCounts(data.events, now);
  const snoozeFor = (min: number) => {
    const s = { last: d.last.toISOString(), until: Date.now() + min * 60_000 };
    try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
    setSnooze(s);
  };
  return (
    <div className="still-running pump-reminder" data-type="pump" style={{ ['--acc' as string]: 'var(--acc-pump)' }}>
      <p className="still-running-q"><b>Time to pump{d.side !== 'both' ? ` (${SIDE[d.side]})` : ''}.</b> Last session {formatDuration(now.getTime() - d.last.getTime())} ago.</p>
      <p className="still-running-who">
        Last 24 h: L {c.left} · R {c.right} sessions of 15+ min (aim {PUMP_TARGET.min}–{PUMP_TARGET.max} each)
      </p>
      <div className="still-running-actions">
        <IonButton size="small" onClick={onStart}>Start pumping</IonButton>
        <IonButton size="small" fill="outline" onClick={() => snoozeFor(30)}>In 30 min</IonButton>
      </div>
    </div>
  );
}
