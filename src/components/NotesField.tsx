import { IonItem, IonTextarea } from '@ionic/react';

export default function NotesField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <IonItem>
      <IonTextarea label="Notes" labelPlacement="stacked" autoGrow value={value}
        onIonInput={(e) => onChange(e.detail.value ?? '')} />
    </IonItem>
  );
}
