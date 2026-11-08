import { isUniqueViolation, type SqlStatement } from '../../driver';
import { placeholders, u, type RepoContext } from '../context';
import { DomainError } from '@/domain/errors';
import { naturalId, newId } from '@/domain/ids';
import type { TagRepository } from '@/domain/repositories';
import { normalizeTagName } from '@/domain/schemas';
import type { Tag, TaggableType, UUID } from '@/domain/types';

interface TagRow {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
  updated_at: string;
}

const toTag = (r: TagRow): Tag => ({
  id: r.id,
  name: r.name,
  color: u(r.color),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/**
 * Statements that make `entityId`'s live tag set exactly `tagIds`. Write-only (no reads),
 * so callers can include them in their own transaction. Links use natural IDs and are
 * revived rather than duplicated (FC-5).
 */
export function setTagsStatements(
  now: string,
  entityType: TaggableType,
  entityId: UUID,
  tagIds: readonly UUID[],
): SqlStatement[] {
  const ids = [...new Set(tagIds)];
  const stmts: SqlStatement[] = [
    {
      sql: `UPDATE entity_tags SET deleted_at = ?, updated_at = ?
            WHERE entity_type = ? AND entity_id = ? AND deleted_at IS NULL
            ${ids.length ? `AND tag_id NOT IN (${placeholders(ids.length)})` : ''}`,
      params: [now, now, entityType, entityId, ...ids],
    },
  ];
  for (const tagId of ids) {
    stmts.push({
      sql: `INSERT INTO entity_tags (id, tag_id, entity_type, entity_id, created_at, updated_at, deleted_at)
            VALUES (?, ?, ?, ?, ?, ?, NULL)
            ON CONFLICT(id) DO UPDATE SET deleted_at = NULL, updated_at = excluded.updated_at
            WHERE entity_tags.deleted_at IS NOT NULL`,
      params: [naturalId('entity_tag', tagId, entityType, entityId), tagId, entityType, entityId, now, now],
    });
  }
  return stmts;
}

/** Soft-deletes every tag link of an entity (used when the entity is deleted). */
export const clearTagsStatement = (now: string, entityType: TaggableType, entityId: UUID): SqlStatement => ({
  sql: `UPDATE entity_tags SET deleted_at = ?, updated_at = ? WHERE entity_type = ? AND entity_id = ? AND deleted_at IS NULL`,
  params: [now, now, entityType, entityId],
});

/** Loads live tag IDs for many entities in one query. */
export async function loadTagIds(
  ctx: RepoContext,
  entityType: TaggableType,
  entityIds: readonly UUID[],
): Promise<Map<UUID, UUID[]>> {
  const out = new Map<UUID, UUID[]>(entityIds.map((id) => [id, []]));
  if (entityIds.length === 0) return out;
  // Chunk to stay well under SQLite's bound-parameter limit.
  for (let i = 0; i < entityIds.length; i += 500) {
    const chunk = entityIds.slice(i, i + 500);
    const rows = await ctx.db.query<{ entity_id: string; tag_id: string }>(
      `SELECT et.entity_id, et.tag_id FROM entity_tags et JOIN tags t ON t.id = et.tag_id
       WHERE et.entity_type = ? AND et.deleted_at IS NULL AND t.deleted_at IS NULL
         AND et.entity_id IN (${placeholders(chunk.length)})
       ORDER BY t.name`,
      [entityType, ...chunk],
    );
    for (const r of rows) out.get(r.entity_id)?.push(r.tag_id);
  }
  return out;
}

export function createTagRepository(ctx: RepoContext): TagRepository {
  const { db } = ctx;

  const get = async (id: UUID) => {
    const rows = await db.query<TagRow>('SELECT * FROM tags WHERE id = ? AND deleted_at IS NULL', [id]);
    return rows[0] ? toTag(rows[0]) : null;
  };
  const byName = async (name: string) => {
    const rows = await db.query<TagRow>('SELECT * FROM tags WHERE name = ? AND deleted_at IS NULL', [name]);
    return rows[0] ? toTag(rows[0]) : null;
  };
  const requireName = (raw: string) => {
    const name = normalizeTagName(raw);
    if (!name) throw new DomainError('validation', 'Tag name is required');
    if (name.length > 60) throw new DomainError('validation', 'Tag name is too long');
    return name;
  };

  return {
    async list() {
      return (await db.query<TagRow>('SELECT * FROM tags WHERE deleted_at IS NULL ORDER BY name')).map(toTag);
    },
    get,
    async search(prefix, limit = 10) {
      const p = normalizeTagName(prefix).replace(/[\\%_]/g, (c) => `\\${c}`);
      const rows = await db.query<TagRow>(
        `SELECT * FROM tags WHERE deleted_at IS NULL AND name LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?`,
        [`${p}%`, limit],
      );
      return rows.map(toTag);
    },
    async getOrCreate(raw) {
      const name = requireName(raw);
      const existing = await byName(name);
      if (existing) return existing;
      const now = ctx.now();
      const id = newId();
      try {
        await db.execute('INSERT INTO tags (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [
          id,
          name,
          now,
          now,
        ]);
      } catch (e) {
        if (isUniqueViolation(e)) return (await byName(name))!;
        throw e;
      }
      return (await get(id))!;
    },
    async rename(id, raw) {
      const name = requireName(raw);
      const other = await byName(name);
      if (other && other.id !== id)
        throw new DomainError('conflict', `A tag named "${name}" already exists. Merge them instead.`);
      const { changes } = await db.execute(
        'UPDATE tags SET name = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
        [name, ctx.now(), id],
      );
      if (!changes) throw new DomainError('not_found', 'Tag not found');
      return (await get(id))!;
    },
    async merge(sourceId, targetId) {
      if (sourceId === targetId) return;
      if (!(await get(sourceId)) || !(await get(targetId)))
        throw new DomainError('not_found', 'Tag not found');
      const links = await db.query<{ entity_type: TaggableType; entity_id: string }>(
        'SELECT entity_type, entity_id FROM entity_tags WHERE tag_id = ? AND deleted_at IS NULL',
        [sourceId],
      );
      const now = ctx.now();
      const stmts: SqlStatement[] = links.map((l) => ({
        sql: `INSERT INTO entity_tags (id, tag_id, entity_type, entity_id, created_at, updated_at, deleted_at)
              VALUES (?, ?, ?, ?, ?, ?, NULL)
              ON CONFLICT(id) DO UPDATE SET deleted_at = NULL, updated_at = excluded.updated_at
              WHERE entity_tags.deleted_at IS NOT NULL`,
        params: [
          naturalId('entity_tag', targetId, l.entity_type, l.entity_id),
          targetId,
          l.entity_type,
          l.entity_id,
          now,
          now,
        ],
      }));
      stmts.push(
        {
          sql: 'UPDATE entity_tags SET deleted_at = ?, updated_at = ? WHERE tag_id = ? AND deleted_at IS NULL',
          params: [now, now, sourceId],
        },
        { sql: 'UPDATE tags SET deleted_at = ?, updated_at = ? WHERE id = ?', params: [now, now, sourceId] },
      );
      await db.transaction(stmts);
    },
    async remove(id) {
      const now = ctx.now();
      await db.transaction([
        {
          sql: 'UPDATE entity_tags SET deleted_at = ?, updated_at = ? WHERE tag_id = ? AND deleted_at IS NULL',
          params: [now, now, id],
        },
        {
          sql: 'UPDATE tags SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
          params: [now, now, id],
        },
      ]);
    },
    async tagsOf(entityType, entityId) {
      return (await loadTagIds(ctx, entityType, [entityId])).get(entityId) ?? [];
    },
    async setTags(entityType, entityId, tagIds) {
      await db.transaction(setTagsStatements(ctx.now(), entityType, entityId, tagIds));
    },
    async taggedWith(tagId) {
      const rows = await db.query<{ entity_type: TaggableType; entity_id: string }>(
        'SELECT entity_type, entity_id FROM entity_tags WHERE tag_id = ? AND deleted_at IS NULL ORDER BY created_at',
        [tagId],
      );
      return rows.map((r) => ({ entityType: r.entity_type, entityId: r.entity_id }));
    },
  };
}
