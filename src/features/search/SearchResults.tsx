import { Link } from 'react-router-dom';
import type { SearchHit, SearchResults as Results, TagHit } from '@/domain/repositories';
import { snippetParts } from '@/domain/services/searchQuery';
import { STATUS_LABELS } from '@/features/goals/describe';
import { useFormatDate } from '@/features/settings/hooks';

export const GROUPS: { type: SearchHit['type']; label: string }[] = [
  { type: 'journal_entry', label: 'Journal' },
  { type: 'habit', label: 'Habits' },
  { type: 'goal', label: 'Goals' },
  { type: 'life_event', label: 'Events' },
];

/** Where a result opens (SRCH-2). */
export const hitPath = (h: Pick<SearchHit, 'type' | 'id'>): string =>
  ({
    journal_entry: `/journal/${h.id}`,
    habit: `/habits/${h.id}`,
    goal: `/goals/${h.id}`,
    life_event: `/events/${h.id}`,
  })[h.type];
export const tagPath = (t: TagHit) => `/settings/tags/${t.id}`;

/** A snippet with its matches in `<mark>`, built from text nodes only (no HTML from data). */
export function Snippet({ text }: { text: string }) {
  return (
    <span className="snippet">
      {snippetParts(text).map((p, i) =>
        p.match ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>,
      )}
    </span>
  );
}

/** The headline of a result: its title, or for an untitled journal entry its date. */
export function useHitTitle() {
  const formatDate = useFormatDate();
  return (h: SearchHit) => h.title ?? (h.date ? formatDate(h.date) : 'Untitled');
}

/** A result's second line: dates, status, and the milestone it was found through. */
export function useHitDetails() {
  const formatDate = useFormatDate();
  return (h: SearchHit) =>
    [
      h.type === 'journal_entry' && h.title && h.date && formatDate(h.date),
      h.type === 'life_event' &&
        h.date &&
        (h.endDate ? `${formatDate(h.date)} – ${formatDate(h.endDate)}` : formatDate(h.date)),
      h.archived && 'Archived',
      h.status && h.status !== 'active' && STATUS_LABELS[h.status],
      h.milestone && `Milestone: ${h.milestone}`,
    ]
      .filter(Boolean)
      .join(' · ');
}

/** Results grouped by type (SRCH-2): journal, habits, goals, events, then tags. */
export function SearchResultList({ results }: { results: Results }) {
  const title = useHitTitle();
  const details = useHitDetails();
  return (
    <div className="stack search-results">
      {GROUPS.map(({ type, label }) => {
        const hits = results.hits.filter((h) => h.type === type);
        if (hits.length === 0) return null;
        return (
          <section key={type} className="stack-sm" aria-labelledby={`results-${type}`}>
            <h2 id={`results-${type}`}>
              {label} <span className="muted">({hits.length})</span>
            </h2>
            <ul className="plain list" aria-label={label}>
              {hits.map((h) => {
                const d = details(h);
                return (
                  <li key={h.id} className="list-row">
                    <Link to={hitPath(h)} className="grow stack-xs search-hit">
                      <span className="habit-name">{title(h)}</span>
                      {d && <span className="small muted">{d}</span>}
                      <span className="small">
                        <Snippet text={h.snippet} />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {results.tags.length > 0 && (
        <section className="stack-sm" aria-labelledby="results-tags">
          <h2 id="results-tags">
            Tags <span className="muted">({results.tags.length})</span>
          </h2>
          <ul className="plain list" aria-label="Tags">
            {results.tags.map((t) => (
              <li key={t.id} className="list-row">
                <Link to={tagPath(t)} className="grow">
                  #{t.name}
                </Link>
                <span className="small muted">
                  {t.count} {t.count === 1 ? 'record' : 'records'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
