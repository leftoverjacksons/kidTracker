import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar } from '@ionic/react';

export default function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <IonPage>
      <IonHeader><IonToolbar><IonTitle>{title}</IonTitle></IonToolbar></IonHeader>
      <IonContent className="ion-padding"><p className="empty">{text}</p></IonContent>
    </IonPage>
  );
}
