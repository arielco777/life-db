import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRepositories } from '@/app/RepositoryProvider';
import type { GoalPatch, MilestonePatch, NewGoal, NewMilestone } from '@/domain/repositories';
import type { Goal, UUID } from '@/domain/types';
import { useToday } from '@/features/settings/hooks';
import { tagKeys } from '@/features/tags/hooks';
import { useToast } from '@/ui/Toast';

export const goalKeys = {
  all: ['goals'] as const,
  list: ['goals', 'list'] as const,
  detail: (id: UUID) => ['goals', 'detail', id] as const,
};

/** Every goal, in user order, with milestones and links. Filter in the caller. */
export function useGoals() {
  const { goals } = useRepositories();
  return useQuery({ queryKey: goalKeys.list, queryFn: () => goals.list() });
}

export function useGoal(id: UUID) {
  const { goals } = useRepositories();
  return useQuery({ queryKey: goalKeys.detail(id), queryFn: () => goals.get(id) });
}

/** Goal and milestone mutations. Each refreshes every goal query; errors show a toast. */
export function useGoalActions() {
  const { goals } = useRepositories();
  const qc = useQueryClient();
  const toast = useToast();
  const today = useToday();
  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: goalKeys.all }),
      qc.invalidateQueries({ queryKey: tagKeys.all }), // usage counts change with goal tags
    ]);
  const opts = { onSettled: invalidate, onError: (e: unknown) => toast.error(e) };

  const create = useMutation({ mutationFn: (input: NewGoal) => goals.create(input), ...opts });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: UUID; patch: GoalPatch }) => goals.update(id, patch),
    ...opts,
  });
  const remove = useMutation({ mutationFn: (id: UUID) => goals.remove(id), ...opts });

  const addMilestone = useMutation({
    mutationFn: ({ goalId, input }: { goalId: UUID; input: NewMilestone }) =>
      goals.addMilestone(goalId, input),
    ...opts,
  });
  const updateMilestone = useMutation({
    mutationFn: ({ id, patch }: { id: UUID; patch: MilestonePatch }) => goals.updateMilestone(id, patch),
    ...opts,
  });
  const removeMilestone = useMutation({ mutationFn: (id: UUID) => goals.removeMilestone(id), ...opts });

  /** Optimistically patches one goal in the detail and list caches, rolling back on error. */
  const patchCached = async (goalId: UUID, fn: (g: Goal) => Goal) => {
    await qc.cancelQueries({ queryKey: goalKeys.all });
    const detail = qc.getQueryData<Goal | null>(goalKeys.detail(goalId));
    const list = qc.getQueryData<Goal[]>(goalKeys.list);
    if (detail) qc.setQueryData(goalKeys.detail(goalId), fn(detail));
    if (list)
      qc.setQueryData(
        goalKeys.list,
        list.map((g) => (g.id === goalId ? fn(g) : g)),
      );
    return () => {
      if (detail) qc.setQueryData(goalKeys.detail(goalId), detail);
      if (list) qc.setQueryData(goalKeys.list, list);
    };
  };

  /** Ticking a milestone updates the checklist and the progress bar straight away. */
  const toggleMilestone = useMutation({
    mutationFn: ({ id, done }: { goalId: UUID; id: UUID; done: boolean }) => goals.setMilestoneDone(id, done),
    onMutate: ({ goalId, id, done }) =>
      patchCached(goalId, (g) => ({
        ...g,
        milestones: g.milestones.map((m) =>
          m.id === id ? { ...m, completedAt: done ? (m.completedAt ?? today) : undefined } : m,
        ),
      })),
    onError: (e, _v, rollback) => {
      rollback?.();
      toast.error(e);
    },
    onSettled: invalidate,
  });

  const reorderMilestones = useMutation({
    mutationFn: ({ goalId, ids }: { goalId: UUID; ids: UUID[] }) => goals.reorderMilestones(goalId, ids),
    onMutate: ({ goalId, ids }) => {
      const pos = new Map(ids.map((id, i) => [id, i]));
      return patchCached(goalId, (g) => ({
        ...g,
        milestones: [...g.milestones].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9)),
      }));
    },
    onError: (e, _v, rollback) => {
      rollback?.();
      toast.error(e);
    },
    onSettled: invalidate,
  });

  return {
    create,
    update,
    remove,
    addMilestone,
    updateMilestone,
    toggleMilestone,
    reorderMilestones,
    removeMilestone,
  };
}
