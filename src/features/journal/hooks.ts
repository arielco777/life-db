import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useRepositories } from '@/app/RepositoryProvider';
import type { JournalCursor, JournalFilter, NewJournalEntry } from '@/domain/repositories';
import type { ISODate, JournalEntry, UUID } from '@/domain/types';
import { tagKeys } from '@/features/tags/hooks';
import { useToast } from '@/ui/Toast';

export const journalKeys = {
  all: ['journal'] as const,
  forDate: (date: ISODate) => ['journal', 'date', date] as const,
  detail: (id: UUID) => ['journal', 'detail', id] as const,
  feed: (filter: JournalFilter) => ['journal', 'feed', filter] as const,
  facets: ['journal', 'facets'] as const,
};

/** Entries loaded per feed page. */
export const FEED_PAGE = 30;

/** The journal feed (JRN-5): newest first, keyset-paginated, filtered. */
export function useJournalFeed(filter: JournalFilter) {
  const { journal } = useRepositories();
  return useInfiniteQuery({
    queryKey: journalKeys.feed(filter),
    queryFn: ({ pageParam }) => journal.list(filter, { after: pageParam, limit: FEED_PAGE }),
    initialPageParam: undefined as JournalCursor | undefined,
    getNextPageParam: (last) => last.next,
  });
}

/** Categories and tags used by any entry, for the feed's filters (CAT-5). */
export function useJournalFacets() {
  const { journal } = useRepositories();
  return useQuery({ queryKey: journalKeys.facets, queryFn: () => journal.facets() });
}

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

/**
 * Soft delete (JRN-7). The entry's own cached detail is left alone: the open editor
 * still shows it, and clearing it would swap the page to "doesn't exist" before the
 * editor can leave. The editor drops it once it has navigated away.
 */
export function useDeleteJournalEntry() {
  const { journal } = useRepositories();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (id: UUID) => journal.remove(id),
    onError: (e) => toast.error(e),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: journalKeys.all, predicate: (q) => q.queryKey[1] !== 'detail' }),
        qc.invalidateQueries({ queryKey: tagKeys.all }),
      ]),
  });
}
