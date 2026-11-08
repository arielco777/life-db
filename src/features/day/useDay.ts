import { useMemo } from 'react';
import { dayWindow } from './rowStatus';
import { valuesByDate, type ValuesByDate } from '@/domain/services/targets';
import type { Habit, HabitEntry, ISODate, JournalEntry, UUID } from '@/domain/types';
import { useEntries } from '@/features/habits/entryHooks';
import { useActiveHabits } from '@/features/habits/hooks';
import { useJournalForDate } from '@/features/journal/hooks';
import { useSettings } from '@/features/settings/hooks';

export interface DayData {
  habits: Habit[];
  /** Values per habit across the loaded window (the date's week and month). */
  valuesByHabit: Map<UUID, ValuesByDate>;
  journal: JournalEntry[];
  window: { from: ISODate; to: ISODate };
  isPending: boolean;
  error: unknown;
}

/**
 * Everything the daily view shows, loaded in parallel (tasks 5.2): habits active on the
 * date, entries for its week + month (targets need the period), and its journal entries.
 * Life events and goals join in V1.1.
 */
export function useDay(date: ISODate): DayData {
  const { week_start } = useSettings();
  const range = dayWindow(date, week_start);
  const habits = useActiveHabits({ from: date, to: date });
  const entries = useEntries(range);
  const journal = useJournalForDate(date);

  const valuesByHabit = useMemo(() => {
    const byHabit = new Map<UUID, HabitEntry[]>();
    for (const e of entries.data ?? []) {
      const list = byHabit.get(e.habitId);
      if (list) list.push(e);
      else byHabit.set(e.habitId, [e]);
    }
    return new Map([...byHabit].map(([id, list]) => [id, valuesByDate(list)]));
  }, [entries.data]);

  return {
    habits: habits.data ?? [],
    valuesByHabit,
    journal: journal.data ?? [],
    window: range,
    isPending: habits.isPending || entries.isPending,
    error: habits.error ?? entries.error ?? journal.error,
  };
}
