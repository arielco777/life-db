import type { GoalStatus, ProgressMode } from '@/domain/types';

export const STATUS_LABELS: Record<GoalStatus, string> = {
  active: 'Active',
  not_started: 'Not started',
  paused: 'Paused',
  completed: 'Completed',
  abandoned: 'Abandoned',
};

/** The goals list's sections, in order. Finished goals come last, folded away. */
export const STATUS_ORDER: readonly GoalStatus[] = [
  'active',
  'not_started',
  'paused',
  'completed',
  'abandoned',
];
export const isFinished = (s: GoalStatus) => s === 'completed' || s === 'abandoned';

export const MODE_LABELS: Record<ProgressMode, { label: string; hint: string }> = {
  milestones: { label: 'Milestones', hint: 'Progress is the share of milestones done' },
  manual: { label: 'Percentage', hint: 'You set how far along you are' },
  numeric: { label: 'Count', hint: 'A number toward a target, e.g. 7 of 20 books' },
};
