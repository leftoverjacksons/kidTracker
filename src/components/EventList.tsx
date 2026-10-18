import { IonItem, IonLabel, IonList, IonListHeader, IonNote } from '@ionic/react';
import { useData, useNow } from '../lib/data';
import { META, summarize } from '../lib/describe';
import { formatDayHeading, formatTime, startOfDay } from '../lib/format';
import { useHousehold } from '../lib/household';
import type { EventRow } from '../lib/types';
import TypeIcon from './TypeIcon';

/** Entries grouped by day, newest first. Tapping one opens it for editing. */
export default function EventList({ events, onOpen, groupByDay = true }: {
  events: EventRow[]; onOpen: (e: EventRow) => void; groupByDay?: boolean;
}) {
  const { settings } = useHousehold();
  const { meds, names } = useData();
  const now = useNow(30_000);
  const groups = new Map<number, EventRow[]>();
  for (const e of events) {
    const k = groupByDay ? startOfDay(new Date(e.started_at)).getTime() : 0;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return (
    <>
      {[...groups.entries()].map(([day, list]) => (
        <IonList key={day} inset>
          {groupByDay && <IonListHeader><IonLabel>{formatDayHeading(new Date(day), now)}</IonLabel></IonListHeader>}
          {list.map((e) => {
            const who = e.created_by ? names[e.created_by] : null;
            return (
              <IonItem key={e.id} button detail={false} onClick={() => onOpen(e)}>
                <span slot="start" className="row-emoji"><TypeIcon type={e.type} /></span>
                <IonLabel>
                  <h3>{META[e.type].label}</h3>
                  <p>{summarize(e, settings, meds, now)}</p>
                  {e.notes && <p className="row-notes">{e.notes}</p>}
                </IonLabel>
                <IonNote slot="end" className="row-time">
                  {formatTime(new Date(e.started_at))}
                  {who && <div className="row-who">{who}</div>}
                </IonNote>
              </IonItem>
            );
          })}
        </IonList>
      ))}
    </>
  );
}
