import { Link } from 'react-router-dom';
import { eventDates, eventLength } from './describe';
import { useEventsOverlapping } from './hooks';
import { diffDays, eachDay } from '@/domain/services/dates';
import type { DateRange } from '@/domain/repositories';
import type { ISODate, LifeEvent } from '@/domain/types';
import { useFormatDate } from '@/features/settings/hooks';

/** The life events covering a date, as a banner at the top of the daily view (tasks 12.4, DAY-1 §2). */
export function DayEvents({ date }: { date: ISODate }) {
  const formatDate = useFormatDate();
  const { data: events = [] } = useEventsOverlapping({ from: date, to: date });
  if (events.length === 0) return null;
  return (
    <ul className="plain day-events" aria-label="Life events">
      {events.map((e) => {
        const days = eventLength(e);
        return (
          <li key={e.id}>
            <span aria-hidden>✦ </span>
            <Link to={`/events/${e.id}`}>{e.name}</Link>
            {days > 1 && (
              <span className="small muted">
                {' '}
                ({eventDates(e, (d) => formatDate(d, false))} · day {diffDays(e.startDate, date) + 1} of{' '}
                {days})
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Names of the events on each day of a range, for the monthly grid's markers (MON-6). */
export function eventsByDay(events: readonly LifeEvent[], range: DateRange): Map<ISODate, string[]> {
  const out = new Map<ISODate, string[]>();
  for (const e of events) {
    const from = e.startDate > range.from ? e.startDate : range.from;
    const end = e.endDate ?? e.startDate;
    const to = end < range.to ? end : range.to;
    for (const d of eachDay({ from, to })) out.set(d, [...(out.get(d) ?? []), e.name]);
  }
  return out;
}
