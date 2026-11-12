import { useMemo } from 'react';
import { EntryMenu } from './EntryMenu';
import { useClearEntry, useEntries, useSetEntry } from './entryHooks';
import { HabitInput } from './inputs/HabitInput';
import type { DateRange } from '@/domain/repositories';
import type { Habit, ISODate } from '@/domain/types';

interface HabitEntryFieldProps {
  habit: Habit;
  date: ISODate;
  /** Accessible name, e.g. "Exercise, August 14". */
  label: string;
  /**
   * The cached window to read from. Pages pass the range they already load (a week, a
   * month) so many fields share one query; defaults to just this day.
   */
  range?: DateRange;
  /** Read-only, e.g. for a future date (ENT-2). */
  disabled?: boolean;
}

/** One habit's value on one date, saved instantly (ENT-5), with the note/clear menu. */
export function HabitEntryField({ habit, date, label, range, disabled }: HabitEntryFieldProps) {
  const { data } = useEntries(range ?? { from: date, to: date });
  const entry = useMemo(
    () => data?.find((e) => e.habitId === habit.id && e.date === date),
    [data, habit.id, date],
  );
  const setEntry = useSetEntry();
  const clearEntry = useClearEntry();

  const onChange = (value: number | undefined) =>
    value === undefined
      ? clearEntry.mutate({ habitId: habit.id, date })
      : setEntry.mutate({ habit, date, value });

  return (
    <span className="entry-field">
      <HabitInput
        habit={habit}
        value={entry?.value}
        onChange={onChange}
        label={label}
        disabled={disabled || !data}
      />
      <EntryMenu
        label={label}
        disabled={disabled}
        isBoolean={habit.type === 'boolean'}
        entry={entry}
        onSaveNote={(note) => entry && setEntry.mutate({ habit, date, value: entry.value, note })}
        onMarkNotDone={() => setEntry.mutate({ habit, date, value: 0 })}
        onClear={() => clearEntry.mutate({ habitId: habit.id, date })}
      />
    </span>
  );
}
