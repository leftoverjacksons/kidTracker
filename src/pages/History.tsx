import { IonButton, IonContent, IonHeader, IonPage, IonRefresher, IonRefresherContent, IonSegment, IonSegmentButton, IonTitle, IonToolbar } from '@ionic/react';
import { useState } from 'react';
import Chips from '../components/Chips';
import EditSheet from '../components/EditSheet';
import EventList from '../components/EventList';
import WeekTimeline from '../components/timeline/WeekTimeline';
import { useData } from '../lib/data';
import { META } from '../lib/describe';
import type { EventRow, EventType } from '../lib/types';
import TypeIcon from '../components/TypeIcon';

const FILTERS: EventType[] = ['sleep', 'nursing', 'bottle', 'diaper', 'pump', 'medicine', 'temperature', 'growth', 'tummy_time', 'bath'];

export default function History() {
  const data = useData();
  const [filter, setFilter] = useState<EventType | null>(null);
  const [editing, setEditing] = useState<EventRow | null>(null);
  const [view, setView] = useState<'list' | 'timeline'>(() => {
    try { return localStorage.getItem('kt.historyView') === 'timeline' ? 'timeline' : 'list'; } catch { return 'list'; }
  });
  const pick = (v: 'list' | 'timeline') => { setView(v); try { localStorage.setItem('kt.historyView', v); } catch { /* ignore */ } };
  const list = filter ? data.events.filter((e) => e.type === filter) : data.events;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar><IonTitle>History</IonTitle></IonToolbar>
        <IonToolbar>
          <IonSegment value={view} onIonChange={(e) => pick(e.detail.value as 'list' | 'timeline')}>
            <IonSegmentButton value="list">List</IonSegmentButton>
            <IonSegmentButton value="timeline">Timeline</IonSegmentButton>
          </IonSegment>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonRefresher slot="fixed" onIonRefresh={async (e) => { await data.reload(); e.detail.complete(); }}>
          <IonRefresherContent />
        </IonRefresher>
        {view === 'timeline' ? (
          <div className="ion-padding-horizontal"><WeekTimeline onEdit={setEditing} /></div>
        ) : (<>
        <div className="ion-padding-horizontal filter-row">
          <Chips options={FILTERS.map((t) => ({ value: t, label: <span className="chip-label"><TypeIcon type={t} />{META[t].label}</span> }))}
            value={filter} onChange={setFilter} />
        </div>
        {list.length === 0 ? <p className="empty">No entries.</p> : <EventList events={list} onOpen={setEditing} />}
        <div className="ion-padding">
          <IonButton expand="block" fill="clear" onClick={() => void data.loadOlder()}>Load older entries</IonButton>
        </div>
        </>)}
        <EditSheet event={editing} onClose={() => setEditing(null)} />
      </IonContent>
    </IonPage>
  );
}
