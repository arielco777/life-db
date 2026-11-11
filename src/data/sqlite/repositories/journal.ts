import type { SqlParam } from '../../driver';
import { n, u, type RepoContext } from '../context';
import { clearTagsStatement, loadTagIds, setTagsStatements } from './tags';
import { DomainError } from '@/domain/errors';
import { newId } from '@/domain/ids';
import type { JournalRepository, NewJournalEntry } from '@/domain/repositories';
import { newJournalEntrySchema, parseOrThrow } from '@/domain/schemas';
import type { JournalEntry } from '@/domain/types';

interface JournalRow {
  id: string;
  entry_date: string;
  title: string | null;
  body: string;
  category_id: string | null;
  created_at: string;
  updated_at: string;
}

const toEntry = (r: JournalRow, tagIds: string[]): JournalEntry => ({
  id: r.id,
  entryDate: r.entry_date,
  title: u(r.title),
  body: r.body,
  categoryId: u(r.category_id),
  tagIds,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function createJournalRepository(ctx: RepoContext): JournalRepository {
  const { db } = ctx;

  const hydrate = async (rows: JournalRow[]) => {
    const tags = await loadTagIds(
      ctx,
      'journal_entry',
      rows.map((r) => r.id),
    );
    return rows.map((r) => toEntry(r, tags.get(r.id) ?? []));
  };
  const get = async (id: string) => {
    const rows = await db.query<JournalRow>(
      'SELECT * FROM journal_entries WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ? (await hydrate(rows))[0]! : null;
  };

  return {
    async forDate(date) {
      const rows = await db.query<JournalRow>(
        'SELECT * FROM journal_entries WHERE entry_date = ? AND deleted_at IS NULL ORDER BY created_at, id',
        [date],
      );
      return hydrate(rows);
    },
    async list(filter = {}, { after, limit = 50 } = {}) {
      const where = ['j.deleted_at IS NULL'];
      const params: SqlParam[] = [];
      const add = (clause: string, value: SqlParam) => {
        where.push(clause);
        params.push(value);
      };
      if (filter.from) add('j.entry_date >= ?', filter.from);
      if (filter.to) add('j.entry_date <= ?', filter.to);
      if (filter.categoryId === null) where.push('j.category_id IS NULL');
      else if (filter.categoryId) add('j.category_id = ?', filter.categoryId);
      if (filter.tagId) {
        where.push(`EXISTS (SELECT 1 FROM entity_tags et WHERE et.entity_type = 'journal_entry'
                    AND et.entity_id = j.id AND et.tag_id = ? AND et.deleted_at IS NULL)`);
        params.push(filter.tagId);
      }
      if (after) {
        // Keyset pagination on (entry_date DESC, created_at DESC, id DESC).
        where.push('(j.entry_date, j.created_at, j.id) < (?, ?, ?)');
        params.push(after.entryDate, after.createdAt, after.id);
      }
      const rows = await db.query<JournalRow>(
        `SELECT j.* FROM journal_entries j WHERE ${where.join(' AND ')}
         ORDER BY j.entry_date DESC, j.created_at DESC, j.id DESC LIMIT ?`,
        [...params, limit + 1],
      );
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        entries: await hydrate(page),
        next:
          rows.length > limit && last
            ? { entryDate: last.entry_date, createdAt: last.created_at, id: last.id }
            : undefined,
      };
    },
    async facets() {
      const [cats, tags] = await Promise.all([
        db.query<{ category_id: string | null }>(
          'SELECT DISTINCT category_id FROM journal_entries WHERE deleted_at IS NULL',
        ),
        db.query<{ tag_id: string }>(
          `SELECT DISTINCT et.tag_id FROM entity_tags et
           JOIN journal_entries j ON j.id = et.entity_id AND j.deleted_at IS NULL
           WHERE et.entity_type = 'journal_entry' AND et.deleted_at IS NULL`,
        ),
      ]);
      return { categoryIds: cats.map((r) => r.category_id), tagIds: tags.map((r) => r.tag_id) };
    },
    get,
    async create(input) {
      const e = parseOrThrow(newJournalEntrySchema, input);
      const id = newId();
      const now = ctx.now();
      await db.transaction([
        {
          sql: `INSERT INTO journal_entries (id, entry_date, title, body, category_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          params: [id, e.entryDate, n(e.title || undefined), e.body ?? '', n(e.categoryId), now, now],
        },
        ...setTagsStatements(now, 'journal_entry', id, e.tagIds ?? []),
      ]);
      return (await get(id))!;
    },
    async update(id, patch) {
      const current = await get(id);
      if (!current) throw new DomainError('not_found', 'Journal entry not found');
      const merged: Record<string, unknown> = {
        entryDate: current.entryDate,
        title: current.title,
        body: current.body,
        categoryId: current.categoryId,
      };
      for (const [k, v] of Object.entries(patch))
        if (v !== undefined && k !== 'tagIds') merged[k] = v === null ? undefined : v;
      const e = parseOrThrow(newJournalEntrySchema, merged as unknown as NewJournalEntry);
      const now = ctx.now();
      await db.transaction([
        {
          sql: 'UPDATE journal_entries SET entry_date = ?, title = ?, body = ?, category_id = ?, updated_at = ? WHERE id = ?',
          params: [e.entryDate, n(e.title || undefined), e.body ?? '', n(e.categoryId), now, id],
        },
        ...(patch.tagIds !== undefined
          ? setTagsStatements(now, 'journal_entry', id, patch.tagIds ?? [])
          : []),
      ]);
      return (await get(id))!;
    },
    async remove(id) {
      const now = ctx.now();
      await db.transaction([
        clearTagsStatement(now, 'journal_entry', id),
        {
          sql: 'UPDATE journal_entries SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
          params: [now, now, id],
        },
      ]);
    },
  };
}
