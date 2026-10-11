import { IonInput, IonItem } from '@ionic/react';

export default function NumberField({ label, value, onChange, unit }: {
  label: string; value: number | null; onChange: (v: number | null) => void; unit?: string;
}) {
  return (
    <IonItem>
      <IonInput
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
