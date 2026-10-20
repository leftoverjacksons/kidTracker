import { IonList, IonSegment, IonSegmentButton } from '@ionic/react';
import { useState, type ReactNode } from 'react';
import { formatVolume } from '../../lib/format';
import type { HouseholdSettings } from '../../lib/types';
import NumberField from '../NumberField';
import { vol } from './units';

const MODE_KEY = 'kt.bottleAmountMode';

/**
 * How much was drunk (typed): either "started with" minus "left in the bottle" (worked
 * out for you), or the amount drunk directly. `startMl` is what was in the bottle at the start, if known.
 * Returns the fields to render plus the resulting amounts in ml (design doc §8a K).
 */
export function useBottleAmounts(settings: HouseholdSettings, initialStartMl: number | null, children?: ReactNode) {
  const v = vol(settings);
  const [mode, setMode] = useState<'left' | 'drank'>(() => {
    if (initialStartMl != null) return 'left';
    try { return localStorage.getItem(MODE_KEY) === 'drank' ? 'drank' : 'left'; } catch { return 'left'; }
  });
  const [start, setStart] = useState<number | null>(initialStartMl != null ? v.toShow(initialStartMl) : null);
  const [left, setLeft] = useState<number | null>(null);
  const [drank, setDrank] = useState<number | null>(null);
  const pick = (m: 'left' | 'drank') => { setMode(m); try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ } };

  const over = mode === 'left' && start != null && left != null && left > start;
  const shown = mode === 'left' ? (start != null && left != null && !over ? Math.round((start - left) * 10) / 10 : null) : drank;
  const drankMl = shown != null && shown > 0 ? v.toStore(shown) : null;
  const startMl = mode === 'left' && start != null && start > 0 ? v.toStore(start) : null;

  const ui = (
    <>
      <IonSegment value={mode} onIonChange={(e) => pick(e.detail.value as 'left' | 'drank')}>
        <IonSegmentButton value="left">Start − left over</IonSegmentButton>
        <IonSegmentButton value="drank">Amount drunk</IonSegmentButton>
      </IonSegment>
      {mode === 'left' ? (
        <>
          <IonList inset>
            <NumberField label="In the bottle at the start" unit={v.unit} value={start} onChange={setStart} />
            <NumberField label="Left in the bottle" unit={v.unit} value={left} onChange={setLeft} />
            {children}
          </IonList>
          <p className={`hint center bottle-drank ${over ? 'bottle-err' : ''}`}>
            {over ? 'More is left than was in the bottle.' : drankMl != null ? <>Drank <b>{formatVolume(drankMl, settings)}</b></> : start != null && left == null ? 'Enter what is left (None if empty).' : ''}
          </p>
        </>
      ) : (
        <>
          <IonList inset>
            <NumberField label="Amount drunk" unit={v.unit} value={drank} onChange={setDrank} />
            {children}
          </IonList>
        </>
      )}
    </>
  );
  return { ui, drankMl, startMl };
}
