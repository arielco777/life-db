import { useId } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSearch } from './hooks';
import { SearchResultList } from './SearchResults';
import type { SearchFilters, SearchType } from '@/domain/repositories';
import { isISODate } from '@/domain/services/clock';
import { CategoryFilter, type CategoryFilterValue } from '@/features/categories/CategoryFilter';
import { useCategories } from '@/features/categories/hooks';
import { useTags } from '@/features/tags/hooks';

const TYPE_OPTIONS: { value: SearchType | ''; label: string }[] = [
  { value: '', label: 'Everything' },
  { value: 'journal_entry', label: 'Journal' },
  { value: 'habit', label: 'Habits' },
  { value: 'goal', label: 'Goals' },
  { value: 'life_event', label: 'Events' },
  { value: 'tag', label: 'Tags' },
];

/** Reads the filters from the URL (SRCH-4): `type`, `from`, `to`, `category` (or `none`), `tag`. */
function filtersFrom(params: URLSearchParams): SearchFilters {
  const type = params.get('type') as SearchType | null;
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const category = params.get('category');
  const tag = params.get('tag');
  return {
    ...(type && TYPE_OPTIONS.some((o) => o.value === type) ? { types: [type] } : {}),
    ...(isISODate(from) ? { from } : {}),
    ...(isISODate(to) ? { to } : {}),
    ...(category ? { categoryId: category === 'none' ? null : category } : {}),
    ...(tag ? { tagId: tag } : {}),
  };
}

/**
 * /search (tasks 14.3, 14.4): a search box, filters by type, dates, category and tag, and
 * results grouped by type. Everything lives in the URL, so going back restores the search.
 */
export function SearchPage() {
  const ids = useId();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const filters = filtersFrom(params);
  const { data, isFetching, searchable, settled } = useSearch(q, filters);
  const { data: categories = [] } = useCategories();
  const { data: tags = [] } = useTags();

  const set = (key: string, value: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const category: CategoryFilterValue = filters.categoryId === null ? 'none' : (filters.categoryId ?? 'all');
  const filtered = Object.keys(filters).length > 0;
  const results = searchable ? data : undefined;
  const count = results ? results.hits.length + results.tags.length : 0;

  return (
    <section className="stack search-page">
      <h1 className="page-title">Search</h1>
      <div className="field">
        <label htmlFor={`${ids}-q`} className="sr-only">
          Search
        </label>
        <input
          id={`${ids}-q`}
          type="search"
          className="search-box"
          placeholder="Search journal, habits, goals, events and tags"
          autoFocus
          value={q}
          onChange={(e) => set('q', e.target.value)}
        />
      </div>

      <div className="row search-filters" role="group" aria-label="Filters">
        <select
          aria-label="Type"
          value={params.get('type') ?? ''}
          onChange={(e) => set('type', e.target.value)}
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="row">
          <input
            type="date"
            aria-label="From"
            value={filters.from ?? ''}
            onChange={(e) => set('from', e.target.value)}
          />
          <span>to</span>
          <input
            type="date"
            aria-label="To"
            value={filters.to ?? ''}
            onChange={(e) => set('to', e.target.value)}
          />
        </span>
        <CategoryFilter
          value={category}
          onChange={(v) => set('category', v === 'all' ? '' : v)}
          usedCategoryIds={[undefined, ...categories.map((c) => c.id)]}
        />
        <select aria-label="Tag" value={filters.tagId ?? ''} onChange={(e) => set('tag', e.target.value)}>
          <option value="">Any tag</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              #{t.name}
            </option>
          ))}
        </select>
        {filtered && (
          <button
            type="button"
            className="secondary"
            onClick={() => setParams(q ? { q } : {}, { replace: true })}
          >
            Clear filters
          </button>
        )}
      </div>

      <p className="sr-only" role="status">
        {searchable && results && settled && !isFetching
          ? `${count} ${count === 1 ? 'result' : 'results'}`
          : ''}
      </p>
      <div className={`stack${isFetching || !settled ? ' refreshing' : ''}`}>
        {!searchable ? (
          <p className="muted">Type to search. Words match their beginnings, so “fren” finds “French”.</p>
        ) : results && count === 0 && settled && !isFetching ? (
          <p className="muted">
            Nothing matches “{q.trim()}”{filtered ? ' with these filters' : ''}.
          </p>
        ) : (
          results && <SearchResultList results={results} />
        )}
      </div>
    </section>
  );
}
