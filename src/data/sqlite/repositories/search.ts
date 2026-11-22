import type { SqlParam } from '../../driver';
import { placeholders, u, type RepoContext } from '../context';
import type { SearchHit, SearchRepository, SearchType, TagHit } from '@/domain/repositories';
import { normalizeTagName } from '@/domain/schemas';
import { MARK_END, MARK_START, searchTokens, toFtsQuery } from '@/domain/services/searchQuery';
import type { GoalStatus } from '@/domain/types';

interface HitRow {
  type: SearchHit['type'];
  id: string;
  src: string;
  src_title: string;
  snip: string;
  rank: number;
  title: string | null;
  date: string | null;
  end_date: string | null;
  category_id: string | null;
  archived_at: string | null;
  status: GoalStatus | null;
}

const RECORD_TYPES = ['journal_entry', 'habit', 'goal', 'life_event'] as const;

/**
 * Search (design §6.7). One FTS5 query over the index the triggers keep in sync, joined back
 * to the source tables for live-ness, titles and filters. Milestone matches resolve to their
 * goal. Tags are matched by name with LIKE.
 */
export function createSearchRepository(ctx: RepoContext): SearchRepository {
  const { db } = ctx;

  return {
    async search(query, filters = {}, limit = 100) {
      const types = new Set<SearchType>(filters.types?.length ? filters.types : [...RECORD_TYPES, 'tag']);
      const match = toFtsQuery(query);
      if (!match) return { hits: [], tags: [] };

      const recordTypes = RECORD_TYPES.filter((t) => types.has(t));
      const where: string[] = ['coalesce(j.id, hb.id, g.id, e.id) IS NOT NULL'];
      const params: SqlParam[] = [match];
      where.push(`r.type IN (${placeholders(recordTypes.length || 1)})`);
      params.push(...(recordTypes.length ? recordTypes : ['none']));

      if (filters.from || filters.to) {
        const from = filters.from ?? '0000-01-01';
        const to = filters.to ?? '9999-12-31';
        // Each record's span: a journal entry's day, an event's days, a habit's run, a goal's
        // start (or creation) to its completion or target date.
        where.push(`(
          (r.type = 'journal_entry' AND j.entry_date BETWEEN ? AND ?) OR
          (r.type = 'life_event' AND e.start_date <= ? AND coalesce(e.end_date, e.start_date) >= ?) OR
          (r.type = 'habit' AND hb.start_date <= ? AND coalesce(hb.end_date, '9999-12-31') >= ?) OR
          (r.type = 'goal' AND coalesce(g.start_date, substr(g.created_at, 1, 10)) <= ?
             AND coalesce(g.completed_at, g.target_date, '9999-12-31') >= ?))`);
        params.push(from, to, to, from, to, from, to, from);
      }
      if (filters.categoryId === null)
        where.push('coalesce(j.category_id, hb.category_id, g.category_id, e.category_id) IS NULL');
      else if (filters.categoryId) {
        where.push('coalesce(j.category_id, hb.category_id, g.category_id, e.category_id) = ?');
        params.push(filters.categoryId);
      }
      if (filters.tagId) {
        where.push(`EXISTS (SELECT 1 FROM entity_tags et WHERE et.entity_type = r.type AND et.entity_id = r.id
                    AND et.tag_id = ? AND et.deleted_at IS NULL)`);
        params.push(filters.tagId);
      }

      // Titles weigh 5× bodies; the unindexed columns get 0.
      const rows = await db.query<HitRow>(
        `WITH hits AS (
           SELECT entity_type, entity_id, title AS src_title,
                  snippet(search_index, -1, '${MARK_START}', '${MARK_END}', '…', 12) AS snip,
                  bm25(search_index, 0, 0, 0, 5.0, 1.0) AS rank
           FROM search_index WHERE search_index MATCH ?
         ), r AS (
           SELECT CASE WHEN h.entity_type = 'goal_milestone' THEN 'goal' ELSE h.entity_type END AS type,
                  CASE WHEN h.entity_type = 'goal_milestone' THEN m.goal_id ELSE h.entity_id END AS id,
                  h.entity_type AS src, h.src_title, h.snip, h.rank
           FROM hits h
           LEFT JOIN goal_milestones m ON h.entity_type = 'goal_milestone' AND m.id = h.entity_id
                                       AND m.deleted_at IS NULL
         )
         SELECT r.type, r.id, r.src, r.src_title, r.snip, r.rank,
                nullif(coalesce(j.title, hb.name, g.title, e.name), '') AS title,
                coalesce(j.entry_date, e.start_date) AS date, e.end_date,
                coalesce(j.category_id, hb.category_id, g.category_id, e.category_id) AS category_id,
                hb.archived_at, g.status
         FROM r
         LEFT JOIN journal_entries j ON r.type = 'journal_entry' AND j.id = r.id AND j.deleted_at IS NULL
         LEFT JOIN habits hb ON r.type = 'habit' AND hb.id = r.id AND hb.deleted_at IS NULL
         LEFT JOIN goals g ON r.type = 'goal' AND g.id = r.id AND g.deleted_at IS NULL
         LEFT JOIN life_events e ON r.type = 'life_event' AND e.id = r.id AND e.deleted_at IS NULL
         WHERE ${where.join(' AND ')}
         ORDER BY r.rank, date DESC, r.id
         LIMIT ?`,
        [...params, limit * 2], // headroom for goals matched both directly and through milestones
      );

      // A goal can match itself and several milestones: keep its best match only.
      const seen = new Set<string>();
      const hits: SearchHit[] = [];
      for (const r of rows) {
        const key = `${r.type}:${r.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({
          type: r.type,
          id: r.id,
          title: u(r.title),
          snippet: r.snip,
          milestone: r.src === 'goal_milestone' ? r.src_title : undefined,
          date: u(r.date),
          endDate: u(r.end_date),
          categoryId: u(r.category_id),
          archived: r.type === 'habit' ? !!r.archived_at : undefined,
          status: u(r.status),
        });
        if (hits.length === limit) break;
      }

      // Tags have no category or date, so those filters leave them out.
      let tags: TagHit[] = [];
      const tagFilters = filters.from || filters.to || filters.categoryId !== undefined || filters.tagId;
      if (types.has('tag') && !tagFilters) {
        const words = searchTokens(query).map((w) => normalizeTagName(w).replace(/[\\%_]/g, (c) => `\\${c}`));
        tags = await db.query<TagHit>(
          `SELECT t.id, t.name,
                  (SELECT count(*) FROM entity_tags et WHERE et.tag_id = t.id AND et.deleted_at IS NULL) AS count
           FROM tags t
           WHERE t.deleted_at IS NULL AND ${words.map(() => "t.name LIKE ? ESCAPE '\\'").join(' AND ')}
           ORDER BY (t.name LIKE ? ESCAPE '\\') DESC, t.name
           LIMIT 20`,
          [...words.map((w) => `%${w}%`), `${words[0]}%`],
        );
      }
      return { hits, tags };
    },
  };
}
