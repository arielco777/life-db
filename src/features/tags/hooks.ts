import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRepositories } from '@/app/RepositoryProvider';
import { normalizeTagName } from '@/domain/schemas';
import type { Habit, JournalEntry, Tag, UUID } from '@/domain/types';
import { useToast } from '@/ui/Toast';

export const tagKeys = {
  all: ['tags'] as const,
  list: ['tags', 'list'] as const,
  usage: ['tags', 'usage'] as const,
  records: (id: UUID) => ['tags', 'records', id] as const,
};

/** Every tag, alphabetical. Small enough to keep whole in the cache for autocomplete. */
export function useTags() {
  const { tags } = useRepositories();
  return useQuery({ queryKey: tagKeys.list, queryFn: () => tags.list() });
}

export function useTagUsage() {
  const { tags } = useRepositories();
  return useQuery({ queryKey: tagKeys.usage, queryFn: () => tags.usageCounts() });
}

export interface TaggedRecords {
  habits: Habit[];
  journal: JournalEntry[];
}

/** Records carrying a tag (TAG-5). Goals and events join in V1.1. */
export function useTaggedRecords(tagId: UUID) {
  const repos = useRepositories();
  return useQuery({
    queryKey: tagKeys.records(tagId),
    queryFn: async (): Promise<TaggedRecords> => {
      const refs = await repos.tags.taggedWith(tagId);
      const ids = (type: string) => refs.filter((r) => r.entityType === type).map((r) => r.entityId);
      const [habits, journal] = await Promise.all([
        Promise.all(ids('habit').map((id) => repos.habits.get(id))),
        Promise.all(ids('journal_entry').map((id) => repos.journal.get(id))),
      ]);
      return {
        habits: habits.filter((h): h is Habit => !!h).sort((a, b) => a.name.localeCompare(b.name)),
        journal: journal
          .filter((j): j is JournalEntry => !!j)
          .sort((a, b) => (a.entryDate < b.entryDate ? 1 : a.entryDate > b.entryDate ? -1 : 0)),
      };
    },
  });
}

/**
 * Autocomplete suggestions (TAG-2): prefix matches first, then other matches, excluding
 * tags already chosen.
 */
export function suggestTags(all: readonly Tag[], query: string, exclude: readonly UUID[], limit = 8): Tag[] {
  const q = normalizeTagName(query);
  const pool = all.filter((t) => !exclude.includes(t.id));
  if (!q) return pool.slice(0, limit);
  const prefix = pool.filter((t) => t.name.startsWith(q));
  const inner = pool.filter((t) => !t.name.startsWith(q) && t.name.includes(q));
  return [...prefix, ...inner].slice(0, limit);
}

export function useTagActions() {
  const { tags } = useRepositories();
  const qc = useQueryClient();
  const toast = useToast();
  // Tag changes alter what records display, so refresh everything tag-related.
  const invalidate = () => qc.invalidateQueries({ queryKey: tagKeys.all });
  const opts = { onSettled: invalidate, onError: (e: unknown) => toast.error(e) };

  const getOrCreate = useMutation({ mutationFn: (name: string) => tags.getOrCreate(name), ...opts });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: UUID; name: string }) => tags.rename(id, name),
    ...opts,
  });
  // Merging and deleting change which tags records carry, so every cached record refetches.
  const everything = { onSettled: () => qc.invalidateQueries(), onError: opts.onError };
  const merge = useMutation({
    mutationFn: ({ sourceId, targetId }: { sourceId: UUID; targetId: UUID }) =>
      tags.merge(sourceId, targetId),
    ...everything,
  });
  const remove = useMutation({ mutationFn: (id: UUID) => tags.remove(id), ...everything });

  return { getOrCreate, rename, merge, remove };
}
