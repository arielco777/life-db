import { n, u, type RepoContext } from '../context';
import { clearTagsStatement, loadTagIds, setTagsStatements } from './tags';
import { DomainError } from '@/domain/errors';
import { newId } from '@/domain/ids';
import type { LifeEventRepository, NewLifeEvent } from '@/domain/repositories';
import { newLifeEventSchema, parseOrThrow } from '@/domain/schemas';
import type { LifeEvent, UUID } from '@/domain/types';

interface EventRow {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  category_id: string | null;
  created_at: string;
  updated_at: string;
}

const toEvent = (r: EventRow, tagIds: UUID[]): LifeEvent => ({
  id: r.id,
  name: r.name,
  description: u(r.description),
  startDate: r.start_date,
  endDate: u(r.end_date),
  categoryId: u(r.category_id),
  tagIds,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Validates; an end date equal to the start is stored as a one-day event (no end). */
function validate(input: NewLifeEvent) {
  const e = parseOrThrow(newLifeEventSchema, input);
  return {
    ...e,
    description: e.description || undefined,
    endDate: e.endDate && e.endDate !== e.startDate ? e.endDate : undefined,
  };
}

export function createLifeEventRepository(ctx: RepoContext): LifeEventRepository {
  const { db } = ctx;

  const hydrate = async (rows: EventRow[]) => {
    const tags = await loadTagIds(
      ctx,
      'life_event',
      rows.map((r) => r.id),
    );
    return rows.map((r) => toEvent(r, tags.get(r.id) ?? []));
  };
  const get = async (id: UUID) => {
    const rows = await db.query<EventRow>('SELECT * FROM life_events WHERE id = ? AND deleted_at IS NULL', [
      id,
    ]);
    return rows[0] ? (await hydrate(rows))[0]! : null;
  };

  return {
    async list() {
      return hydrate(
        await db.query<EventRow>(
          `SELECT * FROM life_events WHERE deleted_at IS NULL
           ORDER BY start_date DESC, coalesce(end_date, start_date) DESC, created_at DESC`,
        ),
      );
    },
    async overlapping({ from, to }) {
      // An event covers [start, end ?? start]; it overlaps when it starts by `to` and ends on or after `from`.
      return hydrate(
        await db.query<EventRow>(
          `SELECT * FROM life_events
           WHERE deleted_at IS NULL AND start_date <= ? AND coalesce(end_date, start_date) >= ?
           ORDER BY start_date, created_at`,
          [to, from],
        ),
      );
    },
    get,
    async create(input) {
      const e = validate(input);
      const id = newId();
      const now = ctx.now();
      await db.transaction([
        {
          sql: `INSERT INTO life_events (id, name, description, start_date, end_date, category_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [id, e.name, n(e.description), e.startDate, n(e.endDate), n(e.categoryId), now, now],
        },
        ...setTagsStatements(now, 'life_event', id, e.tagIds ?? []),
      ]);
      return (await get(id))!;
    },
    async update(id, patch) {
      const current = await get(id);
      if (!current) throw new DomainError('not_found', 'Event not found');
      const merged: Record<string, unknown> = {
        name: current.name,
        description: current.description,
        startDate: current.startDate,
        endDate: current.endDate,
        categoryId: current.categoryId,
      };
      for (const [k, v] of Object.entries(patch))
        if (v !== undefined && k !== 'tagIds') merged[k] = v === null ? undefined : v;
      const e = validate(merged as unknown as NewLifeEvent);
      const now = ctx.now();
      await db.transaction([
        {
          sql: `UPDATE life_events SET name = ?, description = ?, start_date = ?, end_date = ?, category_id = ?,
                updated_at = ? WHERE id = ?`,
          params: [e.name, n(e.description), e.startDate, n(e.endDate), n(e.categoryId), now, id],
        },
        ...(patch.tagIds !== undefined ? setTagsStatements(now, 'life_event', id, patch.tagIds ?? []) : []),
      ]);
      return (await get(id))!;
    },
    async remove(id) {
      const now = ctx.now();
      await db.transaction([
        clearTagsStatement(now, 'life_event', id),
        {
          sql: 'UPDATE life_events SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
          params: [now, now, id],
        },
      ]);
    },
  };
}
