import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRepositories } from '@/app/RepositoryProvider';
import type { DateRange, LifeEventPatch, NewLifeEvent } from '@/domain/repositories';
import type { UUID } from '@/domain/types';
import { tagKeys } from '@/features/tags/hooks';
import { useToast } from '@/ui/Toast';

export const eventKeys = {
  all: ['events'] as const,
  list: ['events', 'list'] as const,
  detail: (id: UUID) => ['events', 'detail', id] as const,
  overlapping: (range: DateRange) => ['events', 'overlapping', range.from, range.to] as const,
};

/** Every event, newest first (EVT-3). */
export function useEvents() {
  const { events } = useRepositories();
  return useQuery({ queryKey: eventKeys.list, queryFn: () => events.list() });
}

export function useEvent(id: UUID) {
  const { events } = useRepositories();
  return useQuery({ queryKey: eventKeys.detail(id), queryFn: () => events.get(id) });
}

/** Events covering any day of the range, oldest first (EVT-2). `enabled: false` skips the query. */
export function useEventsOverlapping(range: DateRange, enabled = true) {
  const { events } = useRepositories();
  return useQuery({
    queryKey: eventKeys.overlapping(range),
    queryFn: () => events.overlapping(range),
    enabled,
  });
}

export function useEventActions() {
  const { events } = useRepositories();
  const qc = useQueryClient();
  const toast = useToast();
  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: eventKeys.all }),
      qc.invalidateQueries({ queryKey: tagKeys.all }), // usage counts change with event tags
    ]);
  const opts = { onSettled: invalidate, onError: (e: unknown) => toast.error(e) };
  return {
    create: useMutation({ mutationFn: (input: NewLifeEvent) => events.create(input), ...opts }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: UUID; patch: LifeEventPatch }) => events.update(id, patch),
      ...opts,
    }),
    remove: useMutation({ mutationFn: (id: UUID) => events.remove(id), ...opts }),
  };
}
