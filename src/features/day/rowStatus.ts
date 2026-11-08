import type { DateRange } from '@/domain/repositories';
import { endOfMonth, endOfWeek, eachDay, startOfMonth, startOfWeek } from '@/domain/services/dates';
import { formatNumber, formatValue } from '@/domain/services/format';
import { expectedForWeek, isScheduled, weeksOf, type WeekStart } from '@/domain/services/schedule';
import { evaluateTarget, type TargetStatus, type ValuesByDate } from '@/domain/services/targets';
import type { Habit, ISODate } from '@/domain/types';

/**
 * Entries the daily view loads: the date's whole week and whole month, so week/month
 * targets can be evaluated (DAY-5) and moving between days of the same month reuses one
 * cached query (NFR-1).
 */
export function dayWindow(date: ISODate, weekStart: WeekStart): DateRange {
  const ws = startOfWeek(date, weekStart);
  const we = endOfWeek(date, weekStart);
  const ms = startOfMonth(date);
  const me = endOfMonth(date);
  return { from: ws < ms ? ws : ms, to: we > me ? we : me };
}

export interface RowStatus {
  /** False for weekday habits on an off day: shown dimmed, still loggable (HAB-5). */
  scheduled: boolean;
  /** "N times per week" progress, when the habit has no explicit target. */
  week?: { done: number; need: number };
  target?: { status: TargetStatus; text: string };
}

type RowHabit = Pick<
  Habit,
  'type' | 'unit' | 'ratingScale' | 'target' | 'frequency' | 'startDate' | 'endDate'
>;

const amount = (h: RowHabit, v: number) =>
  h.type === 'boolean' ? formatNumber(v) : h.type === 'rating' ? formatNumber(v, 1) : formatValue(h, v);

/** What a daily-view row says under the habit name (DAY-5, HAB-5). */
export function rowStatus(h: RowHabit, values: ValuesByDate, date: ISODate, weekStart: WeekStart): RowStatus {
  const out: RowStatus = { scheduled: isScheduled(h, date) };

  const ev = evaluateTarget(h, values, date, weekStart);
  if (ev) {
    const t = ev.target;
    const goal = amount(h, t.value);
    const cmp = t.op === 'at_least' ? '≥' : '≤';
    let text: string;
    if (t.period === 'day') {
      text =
        ev.status === 'met'
          ? `Target met (${cmp} ${goal})`
          : ev.status === 'not_met'
            ? `${t.op === 'at_least' ? 'Below' : 'Over'} target (${cmp} ${goal})`
            : `Target ${cmp} ${goal}`;
    } else {
      const when = t.period === 'week' ? 'this week' : 'this month';
      text =
        h.type === 'rating'
          ? `avg ${ev.actual === null ? '–' : formatNumber(ev.actual, 1)} ${when} · target ${cmp} ${goal}`
          : `${ev.actual === null ? '0' : amount(h, ev.actual)} / ${goal} ${when}${t.op === 'at_most' ? ' (max)' : ''}`;
    }
    out.target = { status: ev.status, text };
  } else if (h.frequency.type === 'times_per_week') {
    const week = { from: startOfWeek(date, weekStart), to: endOfWeek(date, weekStart) };
    const slice = weeksOf(h, week, weekStart)[0];
    const need = slice ? expectedForWeek(h.frequency.count, slice.days.length) : 0;
    const done = eachDay({ from: week.from, to: date }).filter((d) => values.get(d) === 1).length;
    if (need > 0) out.week = { done, need };
  }
  return out;
}
