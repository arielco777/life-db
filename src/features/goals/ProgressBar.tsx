import type { CSSProperties } from 'react';
import { goalProgress } from '@/domain/services/progress';
import type { Goal } from '@/domain/types';

/** A goal's progress as a bar with its label ("2/5", "40%", "7 / 20 books"), GOAL-4. */
export function ProgressBar({ goal, label }: { goal: Goal; label: string }) {
  const { ratio, label: text } = goalProgress(goal);
  return (
    <span className="goal-progress">
      {ratio === null ? (
        <span className="small muted">{text}</span>
      ) : (
        <>
          <span
            className="progress-track"
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(ratio * 100)}
            aria-valuetext={text}
          >
            <span className="progress-fill" style={{ '--progress': ratio } as CSSProperties} />
          </span>
          <span className="small progress-label">{text}</span>
        </>
      )}
    </span>
  );
}
