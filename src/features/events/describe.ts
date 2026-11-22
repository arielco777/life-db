import { diffDays } from '@/domain/services/dates';
import type { LifeEvent } from '@/domain/types';

/** "Aug 10, 2026" or "Aug 10, 2026 – Aug 17, 2026", in the user's date format. */
export const eventDates = (e: Pick<LifeEvent, 'startDate' | 'endDate'>, fmt: (d: string) => string) =>
  e.endDate ? `${fmt(e.startDate)} – ${fmt(e.endDate)}` : fmt(e.startDate);

/** Number of days an event covers, counting both ends. */
export const eventLength = (e: Pick<LifeEvent, 'startDate' | 'endDate'>) =>
  e.endDate ? diffDays(e.startDate, e.endDate) + 1 : 1;
