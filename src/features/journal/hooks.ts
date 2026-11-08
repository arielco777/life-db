import { useQuery } from '@tanstack/react-query';
import { useRepositories } from '@/app/RepositoryProvider';
import type { ISODate } from '@/domain/types';

export const journalKeys = {
  all: ['journal'] as const,
  forDate: (date: ISODate) => ['journal', 'date', date] as const,
};

/** Journal entries written for a date, oldest first (DAY-1). */
export function useJournalForDate(date: ISODate) {
  const { journal } = useRepositories();
  return useQuery({ queryKey: journalKeys.forDate(date), queryFn: () => journal.forDate(date) });
}
