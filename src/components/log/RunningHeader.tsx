import { useData, useNow } from '../../lib/data';
import { formatClock, formatTime } from '../../lib/format';
import type { EventRow } from '../../lib/types';

/** Big live clock plus "started 9:12 PM by …". */
export default function RunningHeader({ event, ms }: { event: EventRow; ms?: number }) {
  const now = useNow();
  const { names } = useData();
  const start = new Date(event.started_at);
  const who = event.created_by ? names[event.created_by] : null;
  return (
    <div className="running">
      <div className="clock">{formatClock(ms ?? now.getTime() - start.getTime())}</div>
      <div className="hint">Started {formatTime(start)}{who ? ` by ${who}` : ''}</div>
    </div>
  );
}
