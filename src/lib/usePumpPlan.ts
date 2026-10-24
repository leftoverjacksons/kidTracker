import { useData } from './data';
import { alignPump, feeds, nextFeed, readPlan } from './feeding';
import { useHousehold } from './household';
import { pumpDue, pumpEveryMin, type PumpDue } from './pump';

/**
 * Next pumping session on this phone, moved to line up with a feed when one is within
 * 30 minutes (design doc §8a Q). `withFeed` is the feed time it was lined up with.
 */
export function usePumpPlan(now: Date): (PumpDue & { withFeed: Date | null }) | null {
  const data = useData();
  const { baby, settings } = useHousehold();
  const d = pumpDue(data.events, now, pumpEveryMin());
  if (!d) return null;
  const plan = readPlan(settings.feeding_plan);
  const fd = feeds(data.events, plan);
  const next = nextFeed(fd, plan, baby?.birth_date ?? null, now);
  const times = [
    fd[fd.length - 1]?.start,                                  // the feed that just happened
    data.running.bottle && new Date(data.running.bottle.started_at), // or is happening now
    data.running.nursing && new Date(data.running.nursing.started_at),
    next?.due,                                                 // the next one
  ].filter((t): t is Date => t instanceof Date);
  const a = alignPump(d, times, now);
  return { ...d, due: a.due, withFeed: a.withFeed };
}
