import { IonButton, IonContent, IonHeader, IonPage, IonRefresher, IonRefresherContent, IonTitle, IonToolbar } from '@ionic/react';
import { useState } from 'react';
import Chips from '../components/Chips';
import EditSheet from '../components/EditSheet';
import EventList from '../components/EventList';
import { useData } from '../lib/data';
import { META } from '../lib/describe';
import type { EventRow, EventType } from '../lib/types';

const FILTERS: EventType[] = ['sleep', 'nursing', 'bottle', 'diaper', 'pump', 'medicine', 'temperature', 'growth', 'tummy_time', 'bath'];

export default function History() {
  const data = useData();
  const [filter, setFilter] = useState<EventType | null>(null);
  const [editing, setEditing] = useState<EventRow | null>(null);
  const list = filter ? data.events.filter((e) => e.type === filter) : data.events;

  return (
    <IonPage>
      <IonHeader><IonToolbar><IonTitle>History</IonTitle></IonToolbar></IonHeader>
      <IonContent>
        <IonRefresher slot="fixed" onIonRefresh={async (e) => { await data.reload(); e.detail.complete(); }}>
          <IonRefresherContent />
        </IonRefresher>
        <div className="ion-padding-horizontal filter-row">
          <Chips options={FILTERS.map((t) => ({ value: t, label: `${META[t].emoji} ${META[t].label}` }))}
            value={filter} onChange={setFilter} />
        </div>
        {list.length === 0 ? <p className="empty">No entries.</p> : <EventList events={list} onOpen={setEditing} />}
        <div className="ion-padding">
          <IonButton expand="block" fill="clear" onClick={() => void data.loadOlder()}>Load older entries</IonButton>
        </div>
        <EditSheet event={editing} onClose={() => setEditing(null)} />
      </IonContent>
    </IonPage>
  );
}
