import { isUniqueViolation } from '../../driver';
import { n, u, type RepoContext } from '../context';
import { DomainError } from '@/domain/errors';
import { newId } from '@/domain/ids';
import type { CategoryRepository } from '@/domain/repositories';
import { newCategorySchema, parseOrThrow } from '@/domain/schemas';
import type { Category } from '@/domain/types';

interface CategoryRow {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  sort_order: number;
  is_default: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

const toCategory = (r: CategoryRow): Category => ({
  id: r.id,
  name: r.name,
  color: u(r.color),
  icon: u(r.icon),
  sortOrder: r.sort_order,
  isDefault: r.is_default === 1,
  archivedAt: u(r.archived_at),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const duplicate = (name: string) => new DomainError('conflict', `A category named "${name}" already exists`);

export function createCategoryRepository(ctx: RepoContext): CategoryRepository {
  const { db } = ctx;
  const get = async (id: string) => {
    const rows = await db.query<CategoryRow>('SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL', [
      id,
    ]);
    return rows[0] ? toCategory(rows[0]) : null;
  };

  return {
    async list({ includeArchived = false } = {}) {
      const rows = await db.query<CategoryRow>(
        `SELECT * FROM categories WHERE deleted_at IS NULL ${includeArchived ? '' : 'AND archived_at IS NULL'}
         ORDER BY sort_order, name`,
      );
      return rows.map(toCategory);
    },
    get,
    async create(input) {
      const c = parseOrThrow(newCategorySchema, input);
      const now = ctx.now();
      const id = newId();
      try {
        await db.execute(
          `INSERT INTO categories (id, name, color, icon, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, (SELECT coalesce(max(sort_order), 0) + 1 FROM categories), ?, ?)`,
          [id, c.name, n(c.color), n(c.icon), now, now],
        );
      } catch (e) {
        if (isUniqueViolation(e)) throw duplicate(c.name);
        throw e;
      }
      return (await get(id))!;
    },
    async update(id, patch) {
      const current = await get(id);
      if (!current) throw new DomainError('not_found', 'Category not found');
      const c = parseOrThrow(newCategorySchema, { ...current, ...patch });
      try {
        await db.execute('UPDATE categories SET name = ?, color = ?, icon = ?, updated_at = ? WHERE id = ?', [
          c.name,
          n(c.color),
          n(c.icon),
          ctx.now(),
          id,
        ]);
      } catch (e) {
        if (isUniqueViolation(e)) throw duplicate(c.name);
        throw e;
      }
      return (await get(id))!;
    },
    async archive(id, archived) {
      const now = ctx.now();
      await db.execute(
        'UPDATE categories SET archived_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
        [archived ? now : null, now, id],
      );
    },
    async reorder(ids) {
      const now = ctx.now();
      await db.transaction(
        ids.map((id, i) => ({
          sql: 'UPDATE categories SET sort_order = ?, updated_at = ? WHERE id = ?',
          params: [i + 1, now, id],
        })),
      );
    },
    async remove(id) {
      const now = ctx.now();
      await db.execute(
        'UPDATE categories SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
        [now, now, id],
      );
    },
  };
}
