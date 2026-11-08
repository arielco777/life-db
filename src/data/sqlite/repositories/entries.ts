import { placeholders, u, type RepoContext } from '../context';
import type { createHabitRepository } from './habits';
import { DomainError } from '@/domain/errors';
import { naturalId } from '@/domain/ids';
import type { HabitEntryRepository } from '@/domain/repositories';
import { validateEntryValue } from '@/domain/schemas';
import { isISODate } from '@/domain/services/clock';
import type { HabitEntry } from '@/domain/types';

interface EntryRow {
  id: string;
  habit_id: string;
  date: string;
  value: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

const toEntry = (r: EntryRow): HabitEntry => ({
  id: r.id,
  habitId: r.habit_id,
  date: r.date,
  value: r.value,
  note: u(r.note),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const entryId = (habitId: string, date: string) => naturalId('habit_entry', habitId, date);

export function createHabitEntryRepository(
  ctx: RepoContext,
  habits: ReturnType<typeof createHabitRepository>,
): HabitEntryRepository {
  const { db } = ctx;
  const requireDate = (date: string) => {
    if (!isISODate(date)) throw new DomainError('validation', `Invalid date: ${date}`);
  };
  const get = async (habitId: string, date: string) => {
    const rows = await db.query<EntryRow>('SELECT * FROM habit_entries WHERE id = ? AND deleted_at IS NULL', [
      entryId(habitId, date),
    ]);
    return rows[0] ? toEntry(rows[0]) : null;
  };

  return {
    async forRange({ from, to }, habitIds) {
      if (habitIds && habitIds.length === 0) return [];
      const rows = await db.query<EntryRow>(
        `SELECT * FROM habit_entries
         WHERE deleted_at IS NULL AND date BETWEEN ? AND ?
         ${habitIds ? `AND habit_id IN (${placeholders(habitIds.length)})` : ''}
         ORDER BY date, habit_id`,
        [from, to, ...(habitIds ?? [])],
      );
      return rows.map(toEntry);
    },
    get,
    async set(habitId, date, value, note) {
      requireDate(date);
      const habit = await habits.get(habitId);
      if (!habit) throw new DomainError('not_found', 'Habit not found');
      validateEntryValue(habit, value);
      const now = ctx.now();
      const keepNote = note === undefined;
      // Upsert on the natural ID; also revives a cleared (soft-deleted) entry (ENT-1, FC-5).
      await db.execute(
        `INSERT INTO habit_entries (id, habit_id, date, value, note, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET
           value = excluded.value,
           note = ${keepNote ? 'CASE WHEN habit_entries.deleted_at IS NULL THEN habit_entries.note END' : 'excluded.note'},
           updated_at = excluded.updated_at,
           deleted_at = NULL`,
        [entryId(habitId, date), habitId, date, value, note?.trim() || null, now, now],
      );
      return (await get(habitId, date))!;
    },
    async clear(habitId, date) {
      requireDate(date);
      const now = ctx.now();
      await db.execute(
        'UPDATE habit_entries SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
        [now, now, entryId(habitId, date)],
      );
    },
  };
}
