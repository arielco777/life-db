import {
  describeFrequency,
  describeRun,
  describeTarget,
  orderedWeekdays,
  runNote,
  runState,
} from './describe';
import { draftFrom, toInput } from './HabitForm';

describe('describeFrequency / describeTarget', () => {
  it('summarises schedules', () => {
    expect(describeFrequency({ type: 'daily' })).toBe('Daily');
    expect(describeFrequency({ type: 'times_per_week', count: 3 })).toBe('3× a week');
    expect(describeFrequency({ type: 'weekdays', days: ['fri', 'mon', 'wed'] })).toBe('Mon, Wed, Fri');
    expect(describeFrequency({ type: 'weekdays', days: ['sun', 'mon'] }, 'sun')).toBe('Sun, Mon');
    expect(describeFrequency({ type: 'weekdays', days: ['mon', 'tue', 'wed', 'thu', 'fri'] })).toBe(
      'Weekdays',
    );
    expect(describeFrequency({ type: 'weekdays', days: ['sat', 'sun'] })).toBe('Weekends');
    expect(orderedWeekdays('sun')[0]).toBe('sun');
  });

  it('summarises targets by type', () => {
    expect(describeTarget({ type: 'boolean', target: { value: 4, op: 'at_least', period: 'week' } })).toBe(
      'At least 4× per week',
    );
    expect(
      describeTarget({ type: 'number', unit: 'cups', target: { value: 2, op: 'at_most', period: 'day' } }),
    ).toBe('At most 2 cups per day');
    expect(describeTarget({ type: 'duration', target: { value: 30, op: 'at_least', period: 'day' } })).toBe(
      'At least 30m per day',
    );
    expect(describeTarget({ type: 'rating', target: { value: 7, op: 'at_least', period: 'week' } })).toBe(
      'At least an average of 7 per week',
    );
    expect(describeTarget({ type: 'boolean' })).toBeNull();
  });
});

describe('run window (start / end dates)', () => {
  const T = '2026-08-14';
  it('runState', () => {
    expect(runState({ startDate: '2026-08-01' }, T)).toBe('running');
    expect(runState({ startDate: '2026-08-01', endDate: T }, T)).toBe('running');
    expect(runState({ startDate: '2026-08-01', endDate: '2026-08-13' }, T)).toBe('ended');
    expect(runState({ startDate: '2026-08-20' }, T)).toBe('upcoming');
  });
  it('describeRun', () => {
    expect(describeRun({ startDate: '2026-08-01' }, T, 'en-US')).toBe('From Aug 1, 2026 · no end date');
    expect(describeRun({ startDate: '2026-08-01', endDate: '2026-10-06' }, T, 'en-US')).toBe(
      'Aug 1, 2026 – Oct 6, 2026 · ends in 53 days',
    );
    expect(describeRun({ startDate: '2026-08-01', endDate: T }, T, 'en-US')).toMatch(/ends today$/);
    expect(describeRun({ startDate: '2026-08-01', endDate: '2026-08-15' }, T, 'en-US')).toMatch(
      /ends in 1 day$/,
    );
    expect(describeRun({ startDate: '2026-07-01', endDate: '2026-07-31' }, T, 'en-US')).toBe(
      'Jul 1, 2026 – Jul 31, 2026 · ended',
    );
    expect(describeRun({ startDate: '2026-08-19' }, T, 'en-US')).toBe(
      'Starts Aug 19, 2026 (in 5 days) · no end date',
    );
    expect(describeRun({ startDate: '2026-08-19', endDate: '2026-09-01' }, T, 'en-US')).toMatch(
      /starts in 5 days$/,
    );
  });
  it('runNote for list rows', () => {
    expect(runNote({ startDate: '2026-08-01' }, T, 'en-US')).toBeNull();
    expect(runNote({ startDate: '2026-08-01', endDate: '2026-12-31' }, T, 'en-US')).toBe('Ends Dec 31');
    expect(runNote({ startDate: '2026-07-01', endDate: '2026-07-31' }, T, 'en-US')).toBe('Ended Jul 31');
    expect(runNote({ startDate: '2026-09-01' }, T, 'en-US')).toBe('Starts Sep 1');
  });
});

describe('HabitForm toInput (HAB-1…6)', () => {
  const base = () => ({ ...draftFrom(undefined, '2026-08-14'), name: 'Read' });

  it('defaults: daily checkbox starting today, medium priority', () => {
    expect(toInput(base())).toEqual({
      input: expect.objectContaining({
        name: 'Read',
        type: 'boolean',
        frequency: { type: 'daily' },
        priority: 'medium',
        startDate: '2026-08-14',
        target: undefined,
        unit: undefined,
        ratingScale: undefined,
      }),
    });
  });

  it('requires a name, a valid scale, days, count and a sane date range', () => {
    const r = toInput({
      ...base(),
      name: ' ',
      type: 'rating',
      ratingMax: '1',
      frequency: 'weekdays',
      days: [],
      hasEnd: true,
      endDate: '2026-08-01',
    });
    expect(r.errors).toEqual({
      name: expect.any(String),
      rating: expect.any(String),
      days: expect.any(String),
      endDate: expect.any(String),
    });
    expect(toInput({ ...base(), frequency: 'times_per_week', count: '8' }).errors?.count).toBeDefined();
  });

  it('end date: "Never" saves none even if a date was typed; "On a date" requires one', () => {
    expect(toInput({ ...base(), hasEnd: false, endDate: '2026-12-31' }).input?.endDate).toBeUndefined();
    expect(toInput({ ...base(), hasEnd: true, endDate: '' }).errors?.endDate).toBe(
      'Pick an end date, or choose Never',
    );
    expect(toInput({ ...base(), hasEnd: true, endDate: '2026-12-31' }).input?.endDate).toBe('2026-12-31');
    expect(draftFrom(undefined, '2026-08-14').hasEnd).toBe(false);
  });

  it('parses targets per type', () => {
    const t = (type: 'boolean' | 'number' | 'duration' | 'rating', targetValue: string) =>
      toInput({ ...base(), type, hasTarget: true, targetValue, targetPeriod: 'week' });
    expect(t('duration', '1h30').input?.target).toEqual({ value: 90, op: 'at_least', period: 'week' });
    expect(t('number', '2,5').input?.target?.value).toBe(2.5);
    expect(t('boolean', '4').input?.target?.value).toBe(4);
    expect(t('boolean', '0').errors?.target).toBeDefined();
    expect(t('rating', '11').errors?.target).toBe('A rating from 1 to 10');
    expect(t('duration', 'soon').errors?.target).toBeDefined();
  });

  it('keeps type-specific fields only for their type, and round-trips a habit', () => {
    expect(toInput({ ...base(), type: 'duration', unit: 'cups' }).input?.unit).toBeUndefined();
    const habit = {
      id: 'h',
      name: 'Reading',
      type: 'duration' as const,
      frequency: { type: 'weekdays' as const, days: ['mon' as const] },
      target: { value: 30, op: 'at_least' as const, period: 'day' as const },
      priority: 'high' as const,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      sortOrder: 1,
      tagIds: ['t1'],
      createdAt: '',
      updatedAt: '',
    };
    const draft = draftFrom(habit, '2026-08-14');
    expect(draft.targetValue).toBe('30m');
    expect(draft.hasEnd).toBe(true);
    expect(toInput(draft).input).toMatchObject({
      frequency: habit.frequency,
      target: habit.target,
      priority: 'high',
      endDate: '2026-12-31',
      tagIds: ['t1'],
    });
  });
});
