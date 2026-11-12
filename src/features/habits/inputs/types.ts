import type { Habit } from '@/domain/types';

/** Shared contract of every per-type input (design §6.1). */
export interface ValueInputProps {
  habit: Pick<Habit, 'type' | 'unit' | 'ratingScale' | 'name'>;
  /** `undefined` = not logged (ENT-2). */
  value: number | undefined;
  /** `undefined` clears the entry. Called once per committed change, never per keystroke. */
  onChange(value: number | undefined): void;
  /** Accessible name, e.g. "Sleep, August 14". */
  label: string;
  disabled?: boolean;
}
