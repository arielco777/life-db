import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRepositories } from '@/app/RepositoryProvider';
import type { NewJournalEntry } from '@/domain/repositories';
import type { ISODate, JournalEntry, UUID } from '@/domain/types';
import { tagKeys } from '@/features/tags/hooks';
import { useToast } from '@/ui/Toast';

export const journalKeys = {
  all: ['journal'] as const,
  forDate: (date: ISODate) => ['journal', 'date', date] as const,
  detail: (id: UUID) => ['journal', 'detail', id] as const,
};

/** Journal entries written for a date, oldest first (DAY-1). */
export function useJournalForDate(date: ISODate) {
  const { journal } = useRepositories();
  return useQuery({ queryKey: journalKeys.forDate(date), queryFn: () => journal.forDate(date) });
}

/** One entry, or null when it doesn't exist or was deleted. */
export function useJournalEntry(id: UUID | undefined) {
  const { journal } = useRepositories();
  return useQuery({
    queryKey: journalKeys.detail(id ?? ''),
    queryFn: () => journal.get(id!),
    enabled: !!id,
  });
}

/**
 * After an entry is saved: store it as its own detail and refresh every other journal
 * view (dates, feed). The detail is set rather than refetched so an open editor never
 * sees its own save come back as "new" data.
 */
export function journalSaved(qc: QueryClient, entry: JournalEntry, tagsChanged = false) {
  qc.setQueryData(journalKeys.detail(entry.id), entry);
  return Promise.all([
    qc.invalidateQueries({
      queryKey: journalKeys.all,
      predicate: (q) => q.queryKey[1] !== 'detail',
    }),
    tagsChanged && qc.invalidateQueries({ queryKey: tagKeys.all }),
  ]);
}

export function useCreateJournalEntry() {
  const { journal } = useRepositories();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (input: NewJournalEntry) => journal.create(input),
    onError: (e) => toast.error(e),
    onSuccess: (e) => journalSaved(qc, e, !!e.tagIds.length),
  });
}

/** Soft delete (JRN-7). */
export function useDeleteJournalEntry() {
  const { journal } = useRepositories();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (id: UUID) => journal.remove(id),
    onError: (e) => toast.error(e),
    onSuccess: (_, id) => {
      qc.setQueryData(journalKeys.detail(id), null);
      return Promise.all([
        qc.invalidateQueries({ queryKey: journalKeys.all, predicate: (q) => q.queryKey[1] !== 'detail' }),
        qc.invalidateQueries({ queryKey: tagKeys.all }),
      ]);
    },
  });
}
