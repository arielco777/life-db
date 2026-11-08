import { dayWindow, rowStatus } from './rowStatus';
import type { Habit } from '@/domain/types';

const vals = (o: Record<string, number>) => new Map(Object.entries(o));
const habit = (over: Partial<Habit>) =>
  ({ type: 'boolean', frequency: { type: 'daily' }, startDate: '2026-01-01', ...over }) as Habit;
const THU = '2026-08-13';

describe('dayWindow', () => {
  it('covers the whole week and month of the date', () => {
    expect(dayWindow('2026-08-14', 'mon')).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(dayWindow('2026-09-01', 'mon')).toEqual({ from: '2026-08-31', to: '2026-09-30' });
    expect(dayWindow('2026-08-31', 'sun')).toEqual({ from: '2026-08-01', to: '2026-09-05' });
  });
});

describe('rowStatus (DAY-5, HAB-5)', () => {
  it('marks off days of weekday habits as not scheduled', () => {
    const mwf = habit({ frequency: { type: 'weekdays', days: ['mon', 'wed', 'fri'] } });
    expect(rowStatus(mwf, vals({}), THU, 'mon').scheduled).toBe(false);
    expect(rowStatus(mwf, vals({}), '2026-08-14', 'mon').scheduled).toBe(true);
  });

  it('day targets: met / below / over / not yet logged', () => {
    const read = habit({ type: 'duration', target: { value: 30, op: 'at_least', period: 'day' } });
    expect(rowStatus(read, vals({ [THU]: 45 }), THU, 'mon').target).toEqual({
      status: 'met',
      text: 'Target met (≥ 30m)',
    });
    expect(rowStatus(read, vals({ [THU]: 10 }), THU, 'mon').target?.text).toBe('Below target (≥ 30m)');
    expect(rowStatus(read, vals({}), THU, 'mon').target).toEqual({ status: 'no_data', text: 'Target ≥ 30m' });
    const coffee = habit({
      type: 'number',
      unit: 'cups',
      target: { value: 2, op: 'at_most', period: 'day' },
    });
    expect(rowStatus(coffee, vals({ [THU]: 3 }), THU, 'mon').target).toEqual({
      status: 'not_met',
      text: 'Over target (≤ 2 cups)',
    });
  });

  it('week and month targets show progress so far', () => {
    const ex = habit({ target: { value: 4, op: 'at_least', period: 'week' } });
    const v = vals({ '2026-08-10': 1, '2026-08-11': 1, '2026-08-12': 0, '2026-08-13': 1, '2026-08-14': 1 });
    expect(rowStatus(ex, v, THU, 'mon').target).toEqual({ status: 'in_progress', text: '3 / 4 this week' });
    const reading = habit({ type: 'duration', target: { value: 600, op: 'at_least', period: 'month' } });
    expect(rowStatus(reading, vals({ '2026-08-01': 90 }), THU, 'mon').target?.text).toBe(
      '1h 30m / 10h this month',
    );
    const sugar = habit({ type: 'number', unit: 'g', target: { value: 50, op: 'at_most', period: 'week' } });
    expect(rowStatus(sugar, vals({}), THU, 'mon').target?.text).toBe('0 / 50 g this week (max)');
    const mood = habit({ type: 'rating', target: { value: 7, op: 'at_least', period: 'week' } });
    expect(rowStatus(mood, vals({ '2026-08-10': 6, '2026-08-11': 8 }), THU, 'mon').target?.text).toBe(
      'avg 7 this week · target ≥ 7',
    );
  });

  it('times-per-week habits without a target show week progress, prorated in partial weeks', () => {
    const gym = habit({ frequency: { type: 'times_per_week', count: 3 } });
    expect(rowStatus(gym, vals({ '2026-08-10': 1, '2026-08-12': 1 }), THU, 'mon').week).toEqual({
      done: 2,
      need: 3,
    });
    // Started on Saturday: 2 active days this week → expects 1.
    const late = habit({ frequency: { type: 'times_per_week', count: 3 }, startDate: '2026-08-15' });
    expect(rowStatus(late, vals({}), '2026-08-15', 'mon').week).toEqual({ done: 0, need: 1 });
    expect(rowStatus(habit({}), vals({}), THU, 'mon').week).toBeUndefined();
  });
});
