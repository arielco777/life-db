import { useEffect, useRef, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { entryHeadline, entrySnippet } from './headline';
import { useJournalFacets, useJournalFeed } from './hooks';
import type { JournalFilter } from '@/domain/repositories';
import { isISODate } from '@/domain/services/clock';
import type { ISODate, JournalEntry } from '@/domain/types';
import { CategoryFilter, type CategoryFilterValue } from '@/features/categories/CategoryFilter';
import { useCategories } from '@/features/categories/hooks';
import { useTags } from '@/features/tags/hooks';

const longDate = (d: ISODate) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

const FILTER_KEYS = ['from', 'to', 'category', 'tag'] as const;

/** Filters live in the URL, so coming back from an entry restores them. */
function filterFrom(params: URLSearchParams): JournalFilter {
  const date = (k: string) => {
    const v = params.get(k);
    return v && isISODate(v) ? v : undefined;
  };
  const category = params.get('category');
  return {
    from: date('from'),
    to: date('to'),
    categoryId: category === 'none' ? null : category || undefined,
    tagId: params.get('tag') || undefined,
  };
}

/** Entries grouped by entry date, keeping the feed's newest-first order. */
function byDate(entries: JournalEntry[]): [ISODate, JournalEntry[]][] {
  const groups: [ISODate, JournalEntry[]][] = [];
  for (const e of entries) {
    const last = groups.at(-1);
    if (last?.[0] === e.entryDate) last[1].push(e);
    else groups.push([e.entryDate, [e]]);
  }
  return groups;
}

/**
 * The journal feed (task 7.1, JRN-5): newest first, grouped by date, more entries load as
 * you scroll (or with "Load more"). Filters: date range, category (CAT-5) and tag.
 */
export function JournalFeed() {
  const [params, setParams] = useSearchParams();
  const filter = filterFrom(params);
  const feed = useJournalFeed(filter);
  const facets = useJournalFacets();
  const { data: categories = [] } = useCategories();
  const { data: tags = [] } = useTags();

  const set = (key: (typeof FILTER_KEYS)[number], value: string | undefined) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const filtered = FILTER_KEYS.some((k) => params.has(k));
  const clear = () => setParams({}, { replace: true });

  const usedTags = new Set(facets.data?.tagIds);
  if (filter.tagId) usedTags.add(filter.tagId);
  const tagOptions = tags.filter((t) => usedTags.has(t.id)).sort((a, b) => a.name.localeCompare(b.name));
  const entries = feed.data?.pages.flatMap((p) => p.entries) ?? [];
  const categoryOf = new Map(categories.map((c) => [c.id, c]));
  const tagName = new Map(tags.map((t) => [t.id, t.name]));

  // Infinite scroll: load the next page when the end of the list comes into view.
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <>
      <div className="row journal-filters" role="group" aria-label="Filters">
        <label className="row small">
          From
          <input
            type="date"
            value={filter.from ?? ''}
            max={filter.to}
            onChange={(e) => set('from', e.target.value)}
          />
        </label>
        <label className="row small">
          To
          <input
            type="date"
            value={filter.to ?? ''}
            min={filter.from}
            onChange={(e) => set('to', e.target.value)}
          />
        </label>
        <CategoryFilter
          value={(params.get('category') as CategoryFilterValue | null) ?? 'all'}
          onChange={(v) => set('category', v === 'all' ? undefined : v)}
          usedCategoryIds={(facets.data?.categoryIds ?? []).map((c) => c ?? undefined)}
        />
        <select
          aria-label="Filter by tag"
          value={filter.tagId ?? ''}
          onChange={(e) => set('tag', e.target.value || undefined)}
        >
          <option value="">All tags</option>
          {tagOptions.map((t) => (
            <option key={t.id} value={t.id}>
              #{t.name}
            </option>
          ))}
        </select>
        {filtered && (
          <button type="button" className="secondary" onClick={clear}>
            Clear filters
          </button>
        )}
      </div>

      {feed.error ? (
        <p className="error">Couldn't load the journal.</p>
      ) : feed.isPending ? (
        <p className="muted">Loading…</p>
      ) : entries.length === 0 ? (
        <div className="card empty">
          {filtered ? (
            <>
              <p>No entries match these filters.</p>
              <button type="button" className="secondary" onClick={clear}>
                Clear filters
              </button>
            </>
          ) : (
            <>
              <p>No journal entries yet.</p>
              <Link to="/journal/new" className="button">
                Write the first one
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="journal-feed">
          {byDate(entries).map(([date, dayEntries]) => (
            <section key={date} className="journal-day" aria-label={longDate(date)}>
              <h2 className="group-title">
                <Link to={`/day/${date}`} title="Open this day">
                  {longDate(date)}
                </Link>
              </h2>
              <ul className="plain list">
                {dayEntries.map((e) => {
                  const category = e.categoryId ? categoryOf.get(e.categoryId) : undefined;
                  const snippet = entrySnippet(e);
                  return (
                    <li key={e.id} className="list-row">
                      <Link to={`/journal/${e.id}`} className="grow stack-xs journal-link">
                        <span>{entryHeadline(e)}</span>
                        {snippet && <span className="small muted">{snippet}</span>}
                      </Link>
                      {(category || e.tagIds.length > 0) && (
                        <span className="small muted journal-entry-meta">
                          {category && (
                            <span className="row">
                              <span
                                className="dot"
                                style={{ '--dot': category.color ?? 'var(--border)' } as CSSProperties}
                                aria-hidden
                              />
                              {category.name}
                            </span>
                          )}
                          {e.tagIds.map((t) => tagName.get(t) && <span key={t}>#{tagName.get(t)}</span>)}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <div ref={sentinel} />
          {feed.hasNextPage && (
            <button
              type="button"
              className="secondary"
              disabled={feed.isFetchingNextPage}
              onClick={() => void feed.fetchNextPage()}
            >
              {feed.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      )}
    </>
  );
}
