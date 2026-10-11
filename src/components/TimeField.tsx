import { IonInput, IonItem } from '@ionic/react';
import { fromLocalInput, toLocalInput } from '../lib/format';

/** Date + time picker using the phone's native picker. */
export default function TimeField({ label, value, onChange }: {
  label: string; value: Date | null; onChange: (d: Date | null) => void;
}) {
  return (
    <IonItem>
      <IonInput
        label={label} labelPlacement="stacked" type="datetime-local"
        value={value ? toLocalInput(value) : ''}
        onIonInput={(e) => onChange(fromLocalInput(e.detail.value))}
      />
    </IonItem>
  );
}
