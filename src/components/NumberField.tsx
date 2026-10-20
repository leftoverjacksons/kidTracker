import { IonInput, IonItem } from '@ionic/react';
import { useEffect, useRef } from 'react';

export default function NumberField({ label, value, onChange, unit, autoFocus = false }: {
  label: string; value: number | null; onChange: (v: number | null) => void; unit?: string;
  /** Put the cursor here when shown (opens the number keypad). */
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLIonInputElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => void ref.current?.setFocus(), 350); // after the sheet's open animation
    return () => clearTimeout(t);
  }, [autoFocus]);
  return (
    <IonItem>
      <IonInput
        ref={ref}
        label={unit ? `${label} (${unit})` : label} labelPlacement="stacked"
        type="number" inputmode="decimal" step="any"
        value={value ?? ''}
        onIonInput={(e) => {
          const v = e.detail.value;
          const n = v === '' || v == null ? null : Number(v);
          onChange(n == null || Number.isNaN(n) ? null : n);
        }}
      />
    </IonItem>
  );
}
