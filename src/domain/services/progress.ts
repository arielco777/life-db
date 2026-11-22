import type { Goal } from '../types';
import { formatNumber, formatPercent } from './format';

/** A goal's progress (GOAL-4), whatever its mode. */
export interface GoalProgress {
  /** 0–1 for the progress bar, or null when there's nothing to measure yet. */
  ratio: number | null;
  /** Short text for lists and bars: "2/5", "40%", "7 / 20 books". */
  label: string;
}

type ProgressInput = Pick<
  Goal,
  'progressMode' | 'progressManual' | 'progressCurrent' | 'progressTarget' | 'progressUnit' | 'milestones'
>;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * - `milestones`: completed / total milestones. No milestones yet → no ratio.
 * - `manual`: the percentage the user set (unset counts as 0%).
 * - `numeric`: current / target, capped at 100% for the bar; the label keeps the real
 *   numbers, so going past the target still shows ("23 / 20 books").
 */
export function goalProgress(goal: ProgressInput, locale?: string): GoalProgress {
  switch (goal.progressMode) {
    case 'milestones': {
      const total = goal.milestones.length;
      if (total === 0) return { ratio: null, label: 'No milestones yet' };
      const done = goal.milestones.filter((m) => m.completedAt).length;
      return { ratio: done / total, label: `${done}/${total}` };
    }
    case 'manual': {
      const ratio = clamp01((goal.progressManual ?? 0) / 100);
      return { ratio, label: formatPercent(ratio, locale) };
    }
    case 'numeric': {
      const target = goal.progressTarget;
      if (!target || target <= 0) return { ratio: null, label: 'No target set' };
      const current = goal.progressCurrent ?? 0;
      const unit = goal.progressUnit ? ` ${goal.progressUnit}` : '';
      return {
        ratio: clamp01(current / target),
        label: `${formatNumber(current, 2, locale)} / ${formatNumber(target, 2, locale)}${unit}`,
      };
    }
  }
}
