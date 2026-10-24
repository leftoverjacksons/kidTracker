import { useData } from './data';
import { feeds, nextFeed, readPlan, schedule } from './feeding';
import { useHousehold } from './household';
import { pumpDue, pumpEveryMin } from './pump';

/**
 * Next feed and next pumping session on this phone, lined up when they're within 30
 * minutes of each other (design doc §8a Q). The push-tick function computes the same.
 */
export function useSchedule(now: Date) {
  const data = useData();
  const { baby, settings } = useHousehold();
  const plan = readPlan(settings.feeding_plan);
  const fd = feeds(data.events, plan);
  const next = nextFeed(fd, plan, baby?.birth_date ?? null, now);
  const current = [
    ...fd.slice(-1).map((f) => f.start),                                  // the feed that just happened
    ...data.events.filter((e) => (e.type === 'bottle' || e.type === 'nursing') && !e.ended_at)
      .map((e) => new Date(e.started_at)),                                // or is happening now
  ];
  return { ...schedule(next, pumpDue(data.events, now, pumpEveryMin()), current, now), plan };
}
