import type { HabitFrequency, HabitType } from '../types';
import { eachDay } from './dates';
import { computeStats, previousPeriod, streaks, type BooleanStats } from './stats';

const AUG = { from: '2026-08-01', to: '2026-08-31' };
const habit = (type: HabitType, frequency: HabitFrequency = { type: 'daily' }, startDate = '2026-01-01') => ({
  type,
  frequency,
  startDate,
  endDate: undefined,
});
const vals = (o: Record<string, number>) => new Map(Object.entries(o));
const days = (...ds: number[]) => ds.map((d) => `2026-08-${String(d).padStart(2, '0')}`);
const doneOn = (ds: string[]) => new Map(ds.map((d) => [d, 1]));
const opts = { weekStart: 'mon' as const };

describe('streaks', () => {
  it('finds longest and current runs', () => {
    expect(streaks([true, true, false, true, true, true])).toEqual({ current: 3, longest: 3 });
    expect(streaks([true, true, true, false])).toEqual({ current: 0, longest: 3 });
    expect(streaks([])).toEqual({ current: 0, longest: 0 });
  });
  it('grace skips an open last slot', () => {
    expect(streaks([true, true, false], true)).toEqual({ current: 2, longest: 2 });
  });
});

describe('boolean stats (ANL-1)', () => {
  it('overview example: Exercise 18 / 31 days = 58%', () => {
    const v = doneOn(days(1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 15, 16, 18, 20, 22, 25, 27, 29));
    const s = computeStats(habit('boolean'), v, AUG, opts) as BooleanStats;
    expect(s).toMatchObject({
      done: 18,
      expected: 31,
      longestStreak: 3,
      currentStreak: 0,
      streakUnit: 'day',
    });
    expect(Math.round(s.completion! * 100)).toBe(58);
  });

  it('explicit "not done" (0) does not count, and breaks streaks', () => {
    const s = computeStats(
      habit('boolean'),
      vals({ '2026-08-01': 1, '2026-08-02': 0, '2026-08-03': 1 }),
      {
        from: '2026-08-01',
        to: '2026-08-03',
      },
      opts,
    ) as BooleanStats;
    expect(s).toMatchObject({ done: 2, expected: 3, longestStreak: 1, currentStreak: 1 });
  });

  it('weekday habits ignore unscheduled days (HAB-5) and streak across them', () => {
    const mwf = habit('boolean', { type: 'weekdays', days: ['mon', 'wed', 'fri'] });
    // Mon 10, Wed 12, Fri 14 done; Sat 15 logged but unscheduled
    const s = computeStats(
      mwf,
      doneOn([...days(10, 12, 14, 15)]),
      { from: '2026-08-10', to: '2026-08-16' },
      opts,
    );
    expect(s).toMatchObject({ done: 3, expected: 3, completion: 1, currentStreak: 3, longestStreak: 3 });
  });

  it('a running month counts only up to today, and an unlogged today keeps the streak', () => {
    const v = doneOn(days(11, 12, 13));
    const s = computeStats(habit('boolean'), v, AUG, { ...opts, today: '2026-08-14' }) as BooleanStats;
    expect(s).toMatchObject({ done: 3, expected: 14, currentStreak: 3 });
    // Explicitly marking today "not done" does break it.
    const s2 = computeStats(habit('boolean'), new Map([...v, ['2026-08-14', 0]]), AUG, {
      ...opts,
      today: '2026-08-14',
    });
    expect(s2).toMatchObject({ currentStreak: 0, longestStreak: 3 });
  });

  it('habits starting mid-month only expect their active days', () => {
    const s = computeStats(
      habit('boolean', { type: 'daily' }, '2026-08-21'),
      doneOn(days(21, 22)),
      AUG,
      opts,
    );
    expect(s).toMatchObject({ done: 2, expected: 11 });
  });

  it('nothing expected → completion null', () => {
    const s = computeStats(habit('boolean', { type: 'daily' }, '2026-09-01'), new Map(), AUG, opts);
    expect(s).toMatchObject({ done: 0, expected: 0, completion: null });
  });

  it('times-per-week: caps extra days per week and streaks in weeks', () => {
    const tpw = habit('boolean', { type: 'times_per_week', count: 3 });
    // Weeks (Mon start) in August: [1–2], [3–9], [10–16], [17–23], [24–30], [31]
    // expected per week: 1, 3, 3, 3, 3, 0 → 13
    const v = doneOn([
      ...days(1), // week 1: 1/1
      ...days(3, 4, 5, 6, 7), // week 2: 5 done, capped at 3
      ...days(10, 11, 12), // week 3: 3/3
      ...days(17), // week 4: 1/3 → breaks
      ...days(24, 25, 26), // week 5: 3/3
    ]);
    const s = computeStats(tpw, v, AUG, opts) as BooleanStats;
    expect(s).toMatchObject({ done: 1 + 3 + 3 + 1 + 3, expected: 13, streakUnit: 'week' });
    expect(s.longestStreak).toBe(3);
    expect(s.currentStreak).toBe(1);
  });

  it('times-per-week: the running week does not break the streak', () => {
    const tpw = habit('boolean', { type: 'times_per_week', count: 2 });
    const v = doneOn(days(3, 4, 10, 11, 17)); // week of 17th: 1/2 so far
    const s = computeStats(tpw, v, AUG, { ...opts, today: '2026-08-18' });
    // Weeks: [1–2] need 1, missed · [3–9] 2/2 · [10–16] 2/2 · [17–23] running, 1/2 so far
    expect(s).toMatchObject({ currentStreak: 2, longestStreak: 2, done: 5, expected: 6 });
    // Finishing the running week early extends the streak right away.
    const s2 = computeStats(tpw, new Map([...v, ['2026-08-18', 1]]), AUG, { ...opts, today: '2026-08-18' });
    expect(s2).toMatchObject({ currentStreak: 3, done: 6, expected: 7 }); // week 1 (Aug 1–2) was still missed
  });
});

describe('measurement stats (ANL-1)', () => {
  it('number: total, average, min, max', () => {
    const s = computeStats(
      habit('number'),
      vals({ '2026-08-01': 2, '2026-08-02': 4, '2026-08-05': 3 }),
      AUG,
      opts,
    );
    expect(s).toEqual({ type: 'number', daysLogged: 3, total: 9, average: 3, min: 2, max: 4 });
  });

  it('number: overview example Sleep avg/min/max', () => {
    const sleep = vals({ '2026-08-01': 7.2, '2026-08-02': 4.9, '2026-08-03': 8.4, '2026-08-04': 6.7 });
    const s = computeStats(habit('number'), sleep, AUG, opts);
    expect(s).toMatchObject({ min: 4.9, max: 8.4 });
    expect((s as { average: number }).average).toBeCloseTo(6.8);
  });

  it('duration: totals and both averages', () => {
    // 749 minutes = 12h 29m over 20 logged days in a 31-day month
    const v = new Map(eachDay({ from: '2026-08-01', to: '2026-08-20' }).map((d, i) => [d, i < 3 ? 40 : 37]));
    const s = computeStats(habit('duration'), v, AUG, opts);
    expect(s).toMatchObject({ type: 'duration', total: 3 * 40 + 17 * 37, daysLogged: 20 });
    expect((s as { averagePerCalendarDay: number }).averagePerCalendarDay).toBeCloseTo(749 / 31);
    expect((s as { averagePerLoggedDay: number }).averagePerLoggedDay).toBeCloseTo(749 / 20);
  });

  it('rating: average', () => {
    const s = computeStats(
      habit('rating'),
      vals({ '2026-08-01': 8, '2026-08-02': 6, '2026-08-03': 7 }),
      AUG,
      opts,
    );
    expect(s).toMatchObject({ type: 'rating', average: 7, min: 6, max: 8, daysLogged: 3 });
  });

  it('ignores values outside the range or after today; empty → nulls', () => {
    const v = vals({ '2026-07-31': 100, '2026-08-10': 5, '2026-08-20': 100 });
    expect(computeStats(habit('number'), v, AUG, { ...opts, today: '2026-08-15' })).toMatchObject({
      total: 5,
    });
    expect(computeStats(habit('rating'), new Map(), AUG, opts)).toEqual({
      type: 'rating',
      daysLogged: 0,
      min: null,
      max: null,
      average: null,
    });
    expect(computeStats(habit('duration'), new Map(), AUG, opts)).toMatchObject({
      total: 0,
      averagePerLoggedDay: null,
      averagePerCalendarDay: 0,
    });
  });
});

describe('previousPeriod (ANL-2)', () => {
  it('maps whole months to previous months', () => {
    expect(previousPeriod(AUG)).toEqual({ from: '2026-07-01', to: '2026-07-31' });
    expect(previousPeriod({ from: '2026-03-01', to: '2026-03-31' })).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(previousPeriod({ from: '2026-01-01', to: '2026-12-31' })).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
    });
  });
  it('shifts other ranges back by their length', () => {
    expect(previousPeriod({ from: '2026-08-10', to: '2026-08-16' })).toEqual({
      from: '2026-08-03',
      to: '2026-08-09',
    });
  });
});
