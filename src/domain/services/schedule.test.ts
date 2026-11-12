import type { HabitFrequency } from '../types';
import {
  activeDayCount,
  expectedCompletions,
  expectedForWeek,
  isActiveOn,
  isDoneValue,
  isRestDay,
  isScheduled,
  restDaysLogged,
  scheduledDays,
  weeksOf,
} from './schedule';

const habit = (frequency: HabitFrequency, startDate = '2026-01-01', endDate?: string) => ({
  frequency,
  startDate,
  endDate,
});
const AUG = { from: '2026-08-01', to: '2026-08-31' }; // Aug 1 2026 is a Saturday

describe('schedule (HAB-5)', () => {
  it('rest days are the off days of a weekday habit that rests on them', () => {
    const optional = habit({ type: 'weekdays', days: ['mon', 'wed', 'fri'] });
    const resting = habit(
      { type: 'weekdays', days: ['mon', 'wed', 'fri'], restOnOtherDays: true },
      '2026-08-05',
    );
    expect(isRestDay(optional, '2026-08-15')).toBe(false); // Sat, but optional
    expect(isRestDay(resting, '2026-08-15')).toBe(true); // Sat
    expect(isRestDay(resting, '2026-08-14')).toBe(false); // Fri is scheduled
    expect(isRestDay(resting, '2026-08-04')).toBe(false); // before the start date
    expect(isRestDay(habit({ type: 'daily' }), '2026-08-15')).toBe(false);
    expect(isScheduled(resting, '2026-08-15')).toBe(false);
  });

  it('counts rest days on which the habit was done anyway', () => {
    const h = {
      ...habit({ type: 'weekdays', days: ['mon', 'wed', 'fri'], restOnOtherDays: true }),
      type: 'boolean' as const,
    };
    const values = new Map([
      ['2026-08-14', 1], // Fri: scheduled
      ['2026-08-15', 1], // Sat: rest day, done
      ['2026-08-16', 0], // Sun: rest day, marked not done → fine
      ['2026-09-05', 1], // Sat, outside the range
    ]);
    expect(restDaysLogged(h, values, AUG)).toBe(1);
    expect(isDoneValue(h, 0)).toBe(false);
    expect(isDoneValue({ type: 'number' }, 0)).toBe(true);
  });

  it('respects start and end dates', () => {
    const h = habit({ type: 'daily' }, '2026-08-10', '2026-08-20');
    expect(isActiveOn(h, '2026-08-09')).toBe(false);
    expect(isActiveOn(h, '2026-08-10')).toBe(true);
    expect(isActiveOn(h, '2026-08-20')).toBe(true);
    expect(isActiveOn(h, '2026-08-21')).toBe(false);
    expect(scheduledDays(h, AUG)).toHaveLength(11);
    expect(activeDayCount(h, AUG)).toBe(11);
    expect(scheduledDays(h, { from: '2026-09-01', to: '2026-09-30' })).toEqual([]);
  });

  it('daily habits are scheduled every active day', () => {
    expect(scheduledDays(habit({ type: 'daily' }), AUG)).toHaveLength(31);
  });

  it('weekday habits are scheduled only on their days', () => {
    const mwf = habit({ type: 'weekdays', days: ['mon', 'wed', 'fri'] });
    expect(isScheduled(mwf, '2026-08-14')).toBe(true); // Fri
    expect(isScheduled(mwf, '2026-08-15')).toBe(false); // Sat
    // August 2026: 5 Mondays (3,10,17,24,31), 4 Wednesdays, 4 Fridays
    expect(scheduledDays(mwf, AUG)).toHaveLength(13);
    expect(expectedCompletions(mwf, AUG, 'mon')).toBe(13);
  });

  it('times-per-week habits can be done any active day', () => {
    const h = habit({ type: 'times_per_week', count: 3 });
    expect(isScheduled(h, '2026-08-15')).toBe(true);
  });

  it('splits a range into weeks clipped to the range', () => {
    const weeks = weeksOf(habit({ type: 'daily' }), AUG, 'mon');
    expect(weeks.map((w) => w.days.length)).toEqual([2, 7, 7, 7, 7, 1]); // Sat–Sun, 4 full weeks, Mon 31st
    expect(weeks[0]!.weekStart).toBe('2026-07-27');
    const sunWeeks = weeksOf(habit({ type: 'daily' }), AUG, 'sun');
    expect(sunWeeks.map((w) => w.days.length)).toEqual([1, 7, 7, 7, 7, 2]);
  });

  it('prorates times-per-week expectations for partial weeks', () => {
    expect(expectedForWeek(3, 7)).toBe(3);
    expect(expectedForWeek(3, 2)).toBe(1); // round(0.86)
    expect(expectedForWeek(3, 1)).toBe(0); // round(0.43)
    expect(expectedForWeek(7, 2)).toBe(2);
    expect(expectedForWeek(5, 1)).toBe(1);
    const h = habit({ type: 'times_per_week', count: 3 });
    // weeks [2,7,7,7,7,1] → 1 + 3*4 + 0
    expect(expectedCompletions(h, AUG, 'mon')).toBe(13);
  });

  it('habits starting mid-range only count active days', () => {
    const h = habit({ type: 'times_per_week', count: 3 }, '2026-08-20'); // Thu
    // Active Aug 20–31: Thu–Sun (4 days) → round(12/7)=2, full week → 3, Mon 31st → 0
    expect(expectedCompletions(h, AUG, 'mon')).toBe(5);
  });
});
