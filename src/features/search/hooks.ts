import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useRepositories } from '@/app/RepositoryProvider';
import type { SearchFilters } from '@/domain/repositories';
import { toFtsQuery } from '@/domain/services/searchQuery';

/** How long typing must pause before searching (SRCH-5, design §6.7). */
export const SEARCH_DEBOUNCE_MS = 150;

/** `value`, but only once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/**
 * Results for what's typed, updating while typing (SRCH-5). The previous results stay on
 * screen while the next ones load, so the list doesn't flash empty between keystrokes.
 */
export function useSearch(query: string, filters: SearchFilters = {}, limit = 100) {
  const { search } = useRepositories();
  const q = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const searchable = toFtsQuery(q) !== null;
  const result = useQuery({
    queryKey: ['search', q, filters, limit],
    queryFn: () => search.search(q, filters, limit),
    enabled: searchable,
    placeholderData: keepPreviousData,
    // Records change underneath; always search afresh.
    staleTime: 0,
    gcTime: 30_000,
  });
  return { ...result, searchable, settled: q === query.trim() };
}
