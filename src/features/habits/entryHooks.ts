import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useRepositories } from '@/app/RepositoryProvider';
import type { DateRange } from '@/domain/repositories';
import { validateEntryValue } from '@/domain/schemas';
import type { Habit, HabitEntry, ISODate, UUID } from '@/domain/types';
import { useToast } from '@/ui/Toast';

/**
 * Entry queries are keyed by range and optional habit filter, so the daily view, the
 * monthly grid and a habit page can each cache their own window. Writes patch every
 * cached window that contains the (habit, date) instead of refetching (NFR-1).
 */
export const entryKeys = {
  all: ['entries'] as const,
  range: (range: DateRange, habitIds?: readonly UUID[]) =>
    ['entries', range.from, range.to, habitIds ? [...habitIds].sort().join(',') : '*'] as const,
};

export function useEntries(range: DateRange, habitIds?: readonly UUID[]) {
  const { entries } = useRepositories();
  return useQuery({
    queryKey: entryKeys.range(range, habitIds),
    queryFn: () => entries.forRange(range, habitIds ? [...habitIds] : undefined),
  });
}

const covers = (key: QueryKey, habitId: UUID, date: ISODate) => {
  const [, from, to, filter] = key as readonly [string, string, string, string];
  return date >= from && date <= to && (filter === '*' || filter.split(',').includes(habitId));
};

type Snapshot = [QueryKey, HabitEntry[] | undefined][];

/** Applies `patch` to every cached entry list that covers (habit, date); returns a snapshot for rollback. */
function patchCaches(
  qc: ReturnType<typeof useQueryClient>,
  habitId: UUID,
  date: ISODate,
  patch: (list: HabitEntry[]) => HabitEntry[],
): Snapshot {
  const snapshot: Snapshot = [];
  for (const [key, data] of qc.getQueriesData<HabitEntry[]>({ queryKey: entryKeys.all })) {
    if (!data || !covers(key, habitId, date)) continue;
    snapshot.push([key, data]);
    qc.setQueryData<HabitEntry[]>(key, patch(data));
  }
  return snapshot;
}

const restore = (qc: ReturnType<typeof useQueryClient>, snapshot: Snapshot | undefined) =>
  snapshot?.forEach(([key, data]) => qc.setQueryData(key, data));

export interface SetEntryVars {
  habit: Pick<Habit, 'id' | 'type' | 'ratingScale'>;
  date: ISODate;
  value: number;
  /** `undefined` keeps the current note, `null` clears it (ENT-3). */
  note?: string | null;
}

/**
 * Logs a value (ENT-1, ENT-5): validated, shown immediately, then saved. On failure the
 * caches roll back and a toast explains why (design §6.1).
 */
export function useSetEntry() {
  const { entries } = useRepositories();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ habit, date, value, note }: SetEntryVars) => entries.set(habit.id, date, value, note),
    onMutate: async ({ habit, date, value, note }) => {
      validateEntryValue(habit, value); // throws → onError, nothing is applied
      await qc.cancelQueries({ queryKey: entryKeys.all });
      const now = new Date().toISOString();
      const snapshot = patchCaches(qc, habit.id, date, (list) => {
        const existing = list.find((e) => e.habitId === habit.id && e.date === date);
        const next: HabitEntry = {
          id: existing?.id ?? `optimistic:${habit.id}:${date}`,
          habitId: habit.id,
          date,
          value,
          note: note === undefined ? existing?.note : note?.trim() || undefined,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        return existing ? list.map((e) => (e === existing ? next : e)) : [...list, next];
      });
      return { snapshot };
    },
    onSuccess: (saved) => {
      patchCaches(qc, saved.habitId, saved.date, (list) =>
        list.map((e) => (e.habitId === saved.habitId && e.date === saved.date ? saved : e)),
      );
    },
    onError: (e, _vars, ctx) => {
      restore(qc, ctx?.snapshot);
      toast.error(e);
    },
  });
}

/** Removes the value: "not logged" (ENT-2). Optimistic, with rollback. */
export function useClearEntry() {
  const { entries } = useRepositories();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ habitId, date }: { habitId: UUID; date: ISODate }) => entries.clear(habitId, date),
    onMutate: async ({ habitId, date }) => {
      await qc.cancelQueries({ queryKey: entryKeys.all });
      const snapshot = patchCaches(qc, habitId, date, (list) =>
        list.filter((e) => !(e.habitId === habitId && e.date === date)),
      );
      return { snapshot };
    },
    onError: (e, _vars, ctx) => {
      restore(qc, ctx?.snapshot);
      toast.error(e);
    },
  });
}
