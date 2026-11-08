import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRepositories } from '@/app/RepositoryProvider';
import type { NewJournalEntry } from '@/domain/repositories';
import type { ISODate } from '@/domain/types';
import { tagKeys } from '@/features/tags/hooks';
import { useToast } from '@/ui/Toast';

export const journalKeys = {
  all: ['journal'] as const,
  forDate: (date: ISODate) => ['journal', 'date', date] as const,
};

/** Journal entries written for a date, oldest first (DAY-1). */
export function useJournalForDate(date: ISODate) {
  const { journal } = useRepositories();
  return useQuery({ queryKey: journalKeys.forDate(date), queryFn: () => journal.forDate(date) });
}

export function useCreateJournalEntry() {
  const { journal } = useRepositories();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (input: NewJournalEntry) => journal.create(input),
    onError: (e) => toast.error(e),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: journalKeys.all }),
        qc.invalidateQueries({ queryKey: tagKeys.all }),
      ]),
  });
}
