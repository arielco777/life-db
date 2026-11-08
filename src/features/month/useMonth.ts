import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useRepositories } from '@/app/RepositoryProvider';
import { addMonths, monthRange } from '@/domain/services/dates';
import { valuesByHabit, type ValuesByDate } from '@/domain/services/targets';
import type { Habit, ISOMonth, UUID } from '@/domain/types';
import { entryKeys, useEntries } from '@/features/habits/entryHooks';
import { habitKeys, useActiveHabits } from '@/features/habits/hooks';

export const isISOMonth = (s: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export interface MonthData {
  habits: Habit[];
  valuesByHabit: Map<UUID, ValuesByDate>;
  isPending: boolean;
  error: unknown;
}

/**
 * The monthly grid's data (tasks 6.2): habits active during any part of the month,
 * archived or ended ones included when they were active then (MON-8), and the month's
 * entries. Neighbouring months are prefetched so ‹ › feel instant (MON-2).
 */
export function useMonth(ym: ISOMonth): MonthData {
  const range = monthRange(ym);
  const habits = useActiveHabits(range);
  const entries = useEntries(range);
  const byHabit = useMemo(() => valuesByHabit(entries.data ?? []), [entries.data]);

  const repos = useRepositories();
  const qc = useQueryClient();
  useEffect(() => {
    for (const m of [addMonths(ym, -1), addMonths(ym, 1)]) {
      const r = monthRange(m);
      void qc.prefetchQuery({ queryKey: habitKeys.activeOn(r), queryFn: () => repos.habits.activeOn(r) });
      void qc.prefetchQuery({ queryKey: entryKeys.range(r), queryFn: () => repos.entries.forRange(r) });
    }
  }, [ym, qc, repos]);

  return {
    habits: habits.data ?? [],
    valuesByHabit: byHabit,
    isPending: habits.isPending || entries.isPending,
    error: habits.error ?? entries.error,
  };
}
