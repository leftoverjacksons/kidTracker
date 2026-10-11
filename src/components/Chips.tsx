import { IonChip, IonLabel } from '@ionic/react';

/** Single-select chip row; tapping the selected chip clears it when `clearable`. */
export default function Chips<T extends string | number>({ options, value, onChange, clearable = true }: {
  options: { value: T; label: string }[]; value: T | null; onChange: (v: T | null) => void; clearable?: boolean;
}) {
  return (
    <div className="chips">
      {options.map((o) => (
        <IonChip key={String(o.value)} color={value === o.value ? 'primary' : undefined}
          outline={value !== o.value}
          onClick={() => onChange(value === o.value && clearable ? null : o.value)}>
          <IonLabel>{o.label}</IonLabel>
        </IonChip>
      ))}
    </div>
  );
}
