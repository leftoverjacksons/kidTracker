import { IonItem, IonLabel, IonList, IonListHeader, IonNote } from '@ionic/react';
import { useMemo, type ReactNode } from 'react';
import { useData, useNow } from '../lib/data';
import { META, summarize } from '../lib/describe';
import { feeds, nursingMinutes, readPlan } from '../lib/feeding';
import { formatDayHeading, formatTime, formatVolume, startOfDay } from '../lib/format';
import { useHousehold } from '../lib/household';
import type { EventRow } from '../lib/types';
import TypeIcon from './TypeIcon';

/**
 * Entries grouped by day, newest first. Tapping one opens it for editing. Entries that
 * make up one feed (nursing and bottles less than 20 min apart) are joined by a bracket
 * on the left carrying the feed's estimated total (design doc §8a Q).
 */
export default function EventList({ events, onOpen, groupByDay = true }: {
  events: EventRow[]; onOpen: (e: EventRow) => void; groupByDay?: boolean;
}) {
  const { settings } = useHousehold();
  const data = useData();
  const { meds, names } = data;
  const now = useNow(30_000);
  const plan = readPlan(settings.feeding_plan);

  // Feeds are worked out from all loaded entries, so a filtered list still brackets correctly.
  const feedOf = useMemo(() => {
    const m = new Map<string, { key: string; estMl: number; nursed: boolean }>();
    for (const f of feeds(data.events, plan)) {
      if (f.ids.length < 2) continue;
      for (const id of f.ids) m.set(id, { key: f.ids[0], estMl: f.estMl, nursed: f.nursingMin > 0 && plan.nursing_ml_per_min > 0 });
    }
    return m;
  }, [data.events, plan.nursing_ml_per_min]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = new Map<number, EventRow[]>();
  for (const e of events) {
    const k = groupByDay ? startOfDay(new Date(e.started_at)).getTime() : 0;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }

  const row = (e: EventRow, inFeed: boolean) => {
    const who = e.created_by ? names[e.created_by] : null;
    // Nursing also shows its estimated amount (minutes × the plan's credit).
    const estMl = e.type === 'nursing' && e.ended_at ? nursingMinutes(e) * plan.nursing_ml_per_min : 0;
    const est = estMl >= 1 ? ` · ~${formatVolume(estMl, settings)}` : '';
    return (
      <IonItem key={e.id} button detail={false} onClick={() => onOpen(e)} className={inFeed ? 'in-feed' : undefined}>
        <span slot="start" className="row-emoji"><TypeIcon type={e.type} /></span>
        <IonLabel>
          <h3>{META[e.type].label}</h3>
          <p>{summarize(e, settings, meds, now)}{est}</p>
          {e.notes && <p className="row-notes">{e.notes}</p>}
        </IonLabel>
        <IonNote slot="end" className="row-time">
          {formatTime(new Date(e.started_at))}
          {who && <div className="row-who">{who}</div>}
        </IonNote>
      </IonItem>
    );
  };

  /** Rows, with each run from a feed's first to last member (within this list) wrapped in a bracket. */
  const rows = (list: EventRow[]) => {
    const out: ReactNode[] = [];
    for (let i = 0; i < list.length; i++) {
      const f = feedOf.get(list[i].id);
      const last = f ? list.reduce((j, e, k) => (feedOf.get(e.id)?.key === f.key ? k : j), i) : i;
      if (!f || last === i) { out.push(row(list[i], false)); continue; }
      const span = list.slice(i, last + 1);
      out.push(
        <div key={`feed-${f.key}`} className="feed-bracket" role="group" aria-label={`Feed, about ${formatVolume(f.estMl, settings)}`}>
          <span className="feed-bracket-line" aria-hidden="true" />
          <span className="feed-bracket-label">{f.nursed ? '~' : ''}{formatVolume(f.estMl, settings)}</span>
          {span.map((e) => row(e, feedOf.get(e.id)?.key === f.key))}
        </div>,
      );
      i = last;
    }
    return out;
  };

  return (
    <>
      {[...groups.entries()].map(([day, list]) => (
        <IonList key={day} inset>
          {groupByDay && <IonListHeader><IonLabel>{formatDayHeading(new Date(day), now)}</IonLabel></IonListHeader>}
          {rows(list)}
        </IonList>
      ))}
    </>
  );
}
