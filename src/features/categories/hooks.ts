import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRepositories } from '@/app/RepositoryProvider';
import type { CategoryPatch, NewCategory } from '@/domain/repositories';
import type { Category, UUID } from '@/domain/types';
import { useToast } from '@/ui/Toast';

export const categoryKeys = {
  all: ['categories'] as const,
};

/** Every non-deleted category, archived included, in display order. Filter in the caller. */
export function useCategories() {
  const { categories } = useRepositories();
  return useQuery({
    queryKey: categoryKeys.all,
    queryFn: () => categories.list({ includeArchived: true }),
  });
}

export const activeCategories = (cs: readonly Category[]) => cs.filter((c) => !c.archivedAt);
export const archivedCategories = (cs: readonly Category[]) => cs.filter((c) => !!c.archivedAt);

/** Category writes. Failures surface as a toast; callers may also await the promise. */
export function useCategoryActions() {
  const { categories } = useRepositories();
  const qc = useQueryClient();
  const toast = useToast();
  const invalidate = () => qc.invalidateQueries({ queryKey: categoryKeys.all });
  const opts = { onSettled: invalidate, onError: (e: unknown) => toast.error(e) };

  const create = useMutation({ mutationFn: (input: NewCategory) => categories.create(input), ...opts });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: UUID; patch: CategoryPatch }) => categories.update(id, patch),
    ...opts,
  });
  const archive = useMutation({
    mutationFn: ({ id, archived }: { id: UUID; archived: boolean }) => categories.archive(id, archived),
    ...opts,
  });
  const reorder = useMutation({
    mutationFn: (ids: UUID[]) => categories.reorder(ids),
    // Optimistic: the list moves immediately (NFR-6).
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: categoryKeys.all });
      const previous = qc.getQueryData<Category[]>(categoryKeys.all);
      if (previous) {
        const pos = new Map(ids.map((id, i) => [id, i]));
        qc.setQueryData<Category[]>(
          categoryKeys.all,
          [...previous].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9)),
        );
      }
      return { previous };
    },
    onError: (e, _ids, ctx) => {
      if (ctx?.previous) qc.setQueryData(categoryKeys.all, ctx.previous);
      toast.error(e);
    },
    onSettled: invalidate,
  });

  return { create, update, archive, reorder };
}
