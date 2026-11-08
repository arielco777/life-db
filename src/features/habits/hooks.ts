import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { entryKeys } from './entryHooks';
import { useRepositories } from '@/app/RepositoryProvider';
import type { DateRange, HabitPatch, NewHabit } from '@/domain/repositories';
import type { Habit, UUID } from '@/domain/types';
import { tagKeys } from '@/features/tags/hooks';
import { useToast } from '@/ui/Toast';

export const habitKeys = {
  all: ['habits'] as const,
  list: ['habits', 'list'] as const,
  detail: (id: UUID) => ['habits', 'detail', id] as const,
  activeOn: (range: DateRange) => ['habits', 'activeOn', range.from, range.to] as const,
  hasEntries: (id: UUID) => ['habits', 'hasEntries', id] as const,
};

/** Every non-deleted habit, archived included, in user order. Filter in the caller. */
export function useHabits() {
  const { habits } = useRepositories();
  return useQuery({ queryKey: habitKeys.list, queryFn: () => habits.list({ includeArchived: true }) });
}

/** Habits relevant to a date range, in user order (DAY-1, MON-1, MON-8). */
export function useActiveHabits(range: DateRange) {
  const { habits } = useRepositories();
  return useQuery({ queryKey: habitKeys.activeOn(range), queryFn: () => habits.activeOn(range) });
}

export function useHabit(id: UUID) {
  const { habits } = useRepositories();
  return useQuery({ queryKey: habitKeys.detail(id), queryFn: () => habits.get(id) });
}

/** Whether the type and rating scale are locked (HAB-2). */
export function useHabitHasEntries(id: UUID | undefined) {
  const { habits } = useRepositories();
  return useQuery({
    queryKey: habitKeys.hasEntries(id ?? ''),
    queryFn: () => habits.hasEntries(id!),
    enabled: !!id,
  });
}

export function useHabitActions() {
  const { habits } = useRepositories();
  const qc = useQueryClient();
  const toast = useToast();
  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: habitKeys.all }),
      qc.invalidateQueries({ queryKey: tagKeys.all }), // usage counts change with habit tags
    ]);
  const opts = { onSettled: invalidate, onError: (e: unknown) => toast.error(e) };

  const create = useMutation({ mutationFn: (input: NewHabit) => habits.create(input), ...opts });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: UUID; patch: HabitPatch }) => habits.update(id, patch),
    ...opts,
  });
  const archive = useMutation({
    mutationFn: ({ id, archived }: { id: UUID; archived: boolean }) => habits.archive(id, archived),
    ...opts,
  });
  const remove = useMutation({
    mutationFn: (id: UUID) => habits.remove(id),
    onError: opts.onError,
    onSettled: () => Promise.all([invalidate(), qc.invalidateQueries({ queryKey: entryKeys.all })]),
  });
  const reorder = useMutation({
    mutationFn: (ids: UUID[]) => habits.reorder(ids),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: habitKeys.list });
      const previous = qc.getQueryData<Habit[]>(habitKeys.list);
      if (previous) {
        const pos = new Map(ids.map((id, i) => [id, i]));
        qc.setQueryData<Habit[]>(
          habitKeys.list,
          [...previous].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9)),
        );
      }
      return { previous };
    },
    onError: (e, _ids, ctx) => {
      if (ctx?.previous) qc.setQueryData(habitKeys.list, ctx.previous);
      toast.error(e);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: habitKeys.all }),
  });

  return { create, update, archive, remove, reorder };
}
