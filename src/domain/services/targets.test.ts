import type { Habit, HabitTarget } from '../types';
import { aggregate, evaluateTarget, periodRange } from './targets';

const h = (type: Habit['type'], target: HabitTarget) => ({ type, target });
const vals = (o: Record<string, number>) => new Map(Object.entries(o));

describe('periodRange', () => {
  it('returns the day, week (by week start) or month containing a date', () => {
    expect(periodRange('day', '2026-08-14', 'mon')).toEqual({ from: '2026-08-14', to: '2026-08-14' });
    expect(periodRange('week', '2026-08-14', 'mon')).toEqual({ from: '2026-08-10', to: '2026-08-16' });
    expect(periodRange('week', '2026-08-14', 'sun')).toEqual({ from: '2026-08-09', to: '2026-08-15' });
    expect(periodRange('month', '2026-02-14', 'mon')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});

describe('aggregate', () => {
  it('counts done days, sums amounts, averages ratings', () => {
    expect(aggregate('boolean', [1, 0, 1])).toBe(2);
    expect(aggregate('boolean', [])).toBe(0);
    expect(aggregate('number', [1.5, 2])).toBe(3.5);
    expect(aggregate('duration', [30, 45])).toBe(75);
    expect(aggregate('rating', [6, 8])).toBe(7);
    expect(aggregate('number', [])).toBeNull();
  });
});

describe('evaluateTarget (HAB-4, DAY-5)', () => {
  it('returns null without a target', () => {
    expect(evaluateTarget({ type: 'boolean' }, vals({}), '2026-08-14', 'mon')).toBeNull();
  });

  it('day at_least: met / not met / no data', () => {
    const reading = h('duration', { value: 30, op: 'at_least', period: 'day' });
    expect(evaluateTarget(reading, vals({ '2026-08-14': 45 }), '2026-08-14', 'mon')?.status).toBe('met');
    expect(evaluateTarget(reading, vals({ '2026-08-14': 20 }), '2026-08-14', 'mon')).toMatchObject({
      status: 'not_met',
      actual: 20,
      progress: 20 / 30,
    });
    expect(evaluateTarget(reading, vals({ '2026-08-13': 45 }), '2026-08-14', 'mon')?.status).toBe('no_data');
  });

  it('day at_most: coffee ≤ 2 cups', () => {
    const coffee = h('number', { value: 2, op: 'at_most', period: 'day' });
    expect(evaluateTarget(coffee, vals({ '2026-08-14': 2 }), '2026-08-14', 'mon')?.status).toBe('met');
    expect(evaluateTarget(coffee, vals({ '2026-08-14': 3 }), '2026-08-14', 'mon')?.status).toBe('not_met');
  });

  it('week at_least: exercise 4× per week, in progress until reached or the week ends', () => {
    const ex = h('boolean', { value: 4, op: 'at_least', period: 'week' });
    const v = vals({ '2026-08-10': 1, '2026-08-11': 1, '2026-08-12': 0, '2026-08-13': 1 });
    // Thu Aug 13: 3 done so far, week not over
    expect(evaluateTarget(ex, v, '2026-08-13', 'mon')).toMatchObject({ actual: 3, status: 'in_progress' });
    // Sun Aug 16 (end of week) still 3 → not met
    expect(evaluateTarget(ex, v, '2026-08-16', 'mon')?.status).toBe('not_met');
    // Reaching 4 mid-week → met immediately
    const v2 = new Map([...v, ['2026-08-14', 1]]);
    expect(evaluateTarget(ex, v2, '2026-08-14', 'mon')?.status).toBe('met');
  });

  it('only counts values up to asOf', () => {
    const ex = h('boolean', { value: 2, op: 'at_least', period: 'week' });
    const v = vals({ '2026-08-10': 1, '2026-08-15': 1 });
    expect(evaluateTarget(ex, v, '2026-08-12', 'mon')?.actual).toBe(1);
  });

  it('week start changes the period', () => {
    const ex = h('boolean', { value: 2, op: 'at_least', period: 'week' });
    const v = vals({ '2026-08-09': 1, '2026-08-10': 1 }); // Sun, Mon
    expect(evaluateTarget(ex, v, '2026-08-10', 'mon')?.actual).toBe(1);
    expect(evaluateTarget(ex, v, '2026-08-10', 'sun')?.actual).toBe(2);
  });

  it('at_most sums are not_met as soon as exceeded; met only when the period ends', () => {
    const coffee = h('number', { value: 10, op: 'at_most', period: 'week' });
    expect(
      evaluateTarget(coffee, vals({ '2026-08-10': 4, '2026-08-11': 3 }), '2026-08-11', 'mon')?.status,
    ).toBe('in_progress');
    expect(
      evaluateTarget(coffee, vals({ '2026-08-10': 6, '2026-08-11': 6 }), '2026-08-11', 'mon')?.status,
    ).toBe('not_met');
    expect(evaluateTarget(coffee, vals({ '2026-08-10': 4 }), '2026-08-16', 'mon')?.status).toBe('met');
  });

  it('at_most rating averages stay in progress until the period ends', () => {
    const stress = h('rating', { value: 5, op: 'at_most', period: 'week' });
    const v = vals({ '2026-08-10': 8 });
    expect(evaluateTarget(stress, v, '2026-08-11', 'mon')?.status).toBe('in_progress');
    expect(evaluateTarget(stress, v, '2026-08-16', 'mon')?.status).toBe('not_met');
  });

  it('month targets and empty periods', () => {
    const read = h('duration', { value: 600, op: 'at_least', period: 'month' });
    expect(evaluateTarget(read, vals({}), '2026-08-14', 'mon')?.status).toBe('in_progress');
    expect(evaluateTarget(read, vals({}), '2026-08-31', 'mon')?.status).toBe('no_data');
    expect(
      evaluateTarget(read, vals({ '2026-08-01': 300, '2026-08-20': 300 }), '2026-08-20', 'mon')?.status,
    ).toBe('met');
  });

  it('a zero target is handled without dividing by zero', () => {
    const none = h('number', { value: 0, op: 'at_most', period: 'day' });
    expect(evaluateTarget(none, vals({ '2026-08-14': 0 }), '2026-08-14', 'mon')).toMatchObject({
      status: 'met',
      progress: 1,
    });
  });
});
