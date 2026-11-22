import { goalProgress } from './progress';
import type { Goal, Milestone } from '../types';

const ms = (done: boolean): Milestone => ({
  id: crypto.randomUUID(),
  goalId: 'g',
  title: 'm',
  completedAt: done ? '2026-08-14' : undefined,
  sortOrder: 0,
  createdAt: '',
  updatedAt: '',
});

const goal = (over: Partial<Goal>): Goal => ({
  id: 'g',
  title: 'Learn French',
  priority: 'medium',
  status: 'active',
  progressMode: 'milestones',
  sortOrder: 1,
  milestones: [],
  habitIds: [],
  months: [],
  tagIds: [],
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('goalProgress (GOAL-4)', () => {
  it('milestones: completed over total', () => {
    expect(
      goalProgress(goal({ milestones: [ms(true), ms(true), ms(false), ms(false), ms(false)] }), 'en'),
    ).toEqual({
      ratio: 0.4,
      label: '2/5',
    });
    expect(goalProgress(goal({ milestones: [ms(true)] }), 'en').ratio).toBe(1);
  });

  it('milestones: none yet has no ratio', () => {
    expect(goalProgress(goal({}), 'en')).toEqual({ ratio: null, label: 'No milestones yet' });
  });

  it('manual: the percentage set, unset as 0%', () => {
    expect(goalProgress(goal({ progressMode: 'manual', progressManual: 40 }), 'en')).toEqual({
      ratio: 0.4,
      label: '40%',
    });
    expect(goalProgress(goal({ progressMode: 'manual' }), 'en')).toEqual({ ratio: 0, label: '0%' });
  });

  it('numeric: current over target with the unit, bar capped at 100%', () => {
    const g = goal({
      progressMode: 'numeric',
      progressCurrent: 7,
      progressTarget: 20,
      progressUnit: 'books',
    });
    expect(goalProgress(g, 'en')).toEqual({ ratio: 0.35, label: '7 / 20 books' });
    expect(goalProgress({ ...g, progressCurrent: 23 }, 'en')).toEqual({ ratio: 1, label: '23 / 20 books' });
    expect(goalProgress({ ...g, progressCurrent: undefined, progressUnit: undefined }, 'en')).toEqual({
      ratio: 0,
      label: '0 / 20',
    });
  });

  it('numeric: no target has no ratio', () => {
    expect(goalProgress(goal({ progressMode: 'numeric', progressCurrent: 3 }), 'en')).toEqual({
      ratio: null,
      label: 'No target set',
    });
  });

  it('ignores milestones in the other modes', () => {
    expect(
      goalProgress(goal({ progressMode: 'manual', progressManual: 10, milestones: [ms(true)] }), 'en').ratio,
    ).toBe(0.1);
  });
});
