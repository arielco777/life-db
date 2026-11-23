import type { SqlParam, SqlStatement } from '../../driver';
import type { RepoContext } from '../context';
import { isValidSetting } from '../repositories/settings';
import { DomainError } from '@/domain/errors';
import {
  expectedNaturalId,
  referencedTable,
  REFERENCES,
  TABLE_LABELS,
  type ImportMode,
  type ImportPlan,
  type TableCounts,
} from '@/domain/importFile';
import {
  EXPORT_TABLE_NAMES,
  EXPORT_TABLES,
  exportColumns,
  snakeCase,
  type ExportFile,
  type ExportTable,
} from '@/domain/transfer';

/**
 * Import (V1.5 design §4): `plan` checks a parsed export against the app's data and
 * counts what will change, reading only; `apply` writes it in one transaction.
 */

type Row = Record<string, unknown> & { id: string; updatedAt: string; deletedAt: string | null };
type AppRow = { updatedAt: string; deletedAt: string | null; name?: string };
type AppIndex = Record<ExportTable, Map<string, AppRow>>;

const rowsOf = (file: ExportFile, table: ExportTable) => file[table] as unknown as Row[];
const isLive = (r: { deletedAt: string | null }) => r.deletedAt === null;
const zero = (): TableCounts => ({ add: 0, update: 0, remove: 0, unchanged: 0 });

const fail = (message: string): never => {
  throw new DomainError('validation', message);
};

/** id, updated_at, deleted_at (and the name, for tags and categories) of every app row. */
async function loadAppIndex(ctx: RepoContext): Promise<AppIndex> {
  const out = {} as AppIndex;
  for (const table of EXPORT_TABLE_NAMES) {
    const withName = table === 'tags' || table === 'categories';
    const rows = await ctx.db.query<{
      id: string;
      updated_at: string;
      deleted_at: string | null;
      name?: string;
    }>(`SELECT id, updated_at, deleted_at${withName ? ', name' : ''} FROM ${EXPORT_TABLES[table].sql}`);
    out[table] = new Map(
      rows.map((r) => [r.id, { updatedAt: r.updated_at, deletedAt: r.deleted_at, name: r.name }]),
    );
  }
  return out;
}

/**
 * IMP-4: a tag or custom category in the file with the same name as a *different* live
 * one in the app is combined with the app's (TAG-4 merge): the file's record is dropped,
 * and everything that used it moves to the app's. Tag links get their natural ID again,
 * because it includes the tag's ID. Returns the rewritten file and how many were combined.
 */
function combineSameNames(file: ExportFile, app: AppIndex) {
  const remapFor = (table: 'tags' | 'categories') => {
    const fileById = new Map(rowsOf(file, table).map((r) => [r.id, r]));
    // App records this merge will delete can't absorb anything.
    const willBeDeleted = (id: string, a: AppRow) => {
      const f = fileById.get(id);
      return !!f && !isLive(f) && f.updatedAt > a.updatedAt;
    };
    const byName = new Map<string, string>();
    for (const [id, a] of app[table])
      if (a.deletedAt === null && a.name !== undefined && !willBeDeleted(id, a))
        byName.set(a.name.toLowerCase(), id);
    const remap = new Map<string, string>();
    for (const r of rowsOf(file, table)) {
      if (!isLive(r)) continue;
      const target = byName.get(String(r.name).toLowerCase());
      if (target && target !== r.id) remap.set(r.id, target);
    }
    return remap;
  };
  const tags = remapFor('tags');
  const categories = remapFor('categories');
  if (tags.size === 0 && categories.size === 0) return { file, combined: { tags: 0, categories: 0 } };

  const out = { ...file } as Record<string, unknown>;
  out.tags = file.tags.filter((t) => !tags.has(t.id));
  out.categories = file.categories.filter((c) => !categories.has(c.id));
  for (const table of ['habits', 'goals', 'journalEntries', 'lifeEvents'] as const) {
    out[table] = rowsOf(file, table).map((r) =>
      typeof r.categoryId === 'string' && categories.has(r.categoryId)
        ? { ...r, categoryId: categories.get(r.categoryId) }
        : r,
    );
  }
  // Two links can become the same one (the entity was tagged with both): keep the newest.
  const links = new Map<string, Row>();
  for (const r of rowsOf(file, 'entityTags')) {
    const moved = tags.has(r.tagId as string) ? { ...r, tagId: tags.get(r.tagId as string) } : r;
    const link = { ...moved, id: expectedNaturalId('entityTags', moved)! } as Row;
    const prev = links.get(link.id);
    if (!prev || link.updatedAt > prev.updatedAt) links.set(link.id, link);
  }
  out.entityTags = [...links.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  return { file: out as ExportFile, combined: { tags: tags.size, categories: categories.size } };
}

/**
 * IMP-2: every reference points to a record in the file or (merge) in the app. A live
 * record pointing nowhere makes the file unimportable; a deletion pointing nowhere is
 * dropped, since there's nothing left for it to delete.
 */
function checkReferences(file: ExportFile, app: AppIndex | null) {
  const fileIds = Object.fromEntries(
    EXPORT_TABLE_NAMES.map((t) => [t, new Set(rowsOf(file, t).map((r) => r.id))]),
  ) as Record<ExportTable, Set<string>>;
  const exists = (t: ExportTable, id: string) => fileIds[t].has(id) || !!app?.[t].has(id);
  let dropped = 0;
  const out = { ...file } as Record<string, unknown>;
  for (const table of EXPORT_TABLE_NAMES) {
    const refs = REFERENCES[table];
    if (!refs) continue;
    out[table] = rowsOf(file, table).filter((r) => {
      for (const ref of refs) {
        const v = r[ref.column];
        if (v === null || v === undefined) continue; // optional, or not kept by a tombstone
        const target = referencedTable(ref, r);
        if (exists(target, String(v))) continue;
        if (!isLive(r)) {
          dropped++;
          return false;
        }
        return fail(
          `This export can’t be imported: a ${TABLE_LABELS[table].one} refers to a ${TABLE_LABELS[target].one} that isn’t in the file${app ? ' or in Life DB' : ''}.`,
        );
      }
      return true;
    });
  }
  return { file: out as ExportFile, dropped };
}

export async function planImport(ctx: RepoContext, input: ExportFile, mode: ImportMode): Promise<ImportPlan> {
  const app = await loadAppIndex(ctx);
  const combinedResult =
    mode === 'merge' ? combineSameNames(input, app) : { file: input, combined: { tags: 0, categories: 0 } };
  const { file, dropped } = checkReferences(combinedResult.file, mode === 'merge' ? app : null);

  const counts = Object.fromEntries(EXPORT_TABLE_NAMES.map((t) => [t, zero()])) as Record<
    ExportTable,
    TableCounts
  >;
  for (const table of EXPORT_TABLE_NAMES) {
    const c = counts[table];
    if (mode === 'replace') {
      c.add = rowsOf(file, table).filter(isLive).length;
      c.remove = [...app[table].values()].filter(isLive).length;
      continue;
    }
    for (const r of rowsOf(file, table)) {
      const a = app[table].get(r.id);
      if (!a) {
        if (isLive(r)) c.add++;
        else c.unchanged++; // a deletion of something the app never had
      } else if (r.updatedAt > a.updatedAt) {
        if (isLive(r)) c.update++;
        else if (isLive(a)) c.remove++;
        else c.unchanged++;
      } else c.unchanged++;
    }
  }
  return { mode, file, counts, combined: combinedResult.combined, droppedDeletions: dropped };
}

// ───────── apply ─────────

/** Rows per multi-row statement: few statements, well under SQLite's parameter limit. */
const BATCH = 200;

/**
 * Values for a deleted record's required columns when a replace inserts it (design §4.3).
 * Deleted rows are never read; these exist only so the deletion can be merged later.
 */
function tombstoneFill(table: ExportTable, r: Row): Record<string, unknown> {
  const day = r.createdAt ? String(r.createdAt).slice(0, 10) : '2000-01-01';
  switch (table) {
    case 'categories':
    case 'tags':
    case 'lifeEvents':
      return table === 'lifeEvents' ? { name: '', startDate: day } : { name: '' };
    case 'habits':
      return { name: '', type: 'boolean', startDate: day };
    case 'habitEntries':
      return { value: 0 };
    case 'goals':
      return { title: '' };
    case 'goalMilestones':
      return { title: '' };
    case 'journalEntries':
      return { entryDate: day, body: '' };
    default:
      return {};
  }
}

function sqlValue(table: ExportTable, key: string, v: unknown): SqlParam {
  if ((EXPORT_TABLES[table].booleans as readonly string[]).includes(key)) return v ? 1 : 0;
  return (v ?? null) as SqlParam;
}

/** Multi-row INSERTs of `rows`, all with the columns `keys`. `upsert`: newer wins (IMP-4). */
function inserts(
  table: ExportTable,
  keys: string[],
  rows: Record<string, unknown>[],
  upsert: boolean,
): SqlStatement[] {
  const sql = EXPORT_TABLES[table].sql;
  const cols = keys.map(snakeCase);
  const tuple = `(${cols.map(() => '?').join(', ')})`;
  const conflict = upsert
    ? ` ON CONFLICT(id) DO UPDATE SET ${cols
        .filter((c) => c !== 'id')
        .map((c) => `${c} = excluded.${c}`)
        .join(', ')} WHERE excluded.updated_at > ${sql}.updated_at`
    : '';
  const out: SqlStatement[] = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    out.push({
      sql: `INSERT INTO ${sql} (${cols.join(', ')}) VALUES ${batch.map(() => tuple).join(', ')}${conflict}`,
      params: batch.flatMap((r) => keys.map((k) => sqlValue(table, k, r[k]))),
    });
  }
  return out;
}

/** Merge: apply deletions that are newer than the app's record (IMP-4). */
function deletions(table: ExportTable, rows: Row[]): SqlStatement[] {
  const sql = EXPORT_TABLES[table].sql;
  const out: SqlStatement[] = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    out.push({
      sql: `UPDATE ${sql} SET deleted_at = v.column2, updated_at = v.column3
            FROM (VALUES ${batch.map(() => '(?, ?, ?)').join(', ')}) AS v
            WHERE ${sql}.id = v.column1 AND ${sql}.updated_at < v.column3`,
      params: batch.flatMap((r) => [r.id, r.deletedAt, r.updatedAt]),
    });
  }
  return out;
}

export async function applyImport(ctx: RepoContext, plan: ImportPlan): Promise<void> {
  const { file, mode } = plan;
  const stmts: SqlStatement[] = [];
  if (mode === 'replace') {
    // Emptying the search index first keeps the per-row delete triggers from scanning it.
    stmts.push({ sql: 'DELETE FROM search_index' });
    for (const table of [...EXPORT_TABLE_NAMES].reverse())
      stmts.push({ sql: `DELETE FROM ${EXPORT_TABLES[table].sql}` });
    for (const table of EXPORT_TABLE_NAMES) {
      const rows = rowsOf(file, table);
      stmts.push(...inserts(table, exportColumns(table), rows.filter(isLive), false));
      const gone = rows.filter((r) => !isLive(r)).map((r) => ({ ...tombstoneFill(table, r), ...r }));
      if (gone.length) stmts.push(...inserts(table, Object.keys(gone[0]!), gone, false));
    }
    const now = ctx.now();
    for (const [key, value] of Object.entries(file.settings)) {
      if (!isValidSetting(key, value)) continue; // e.g. a date format this version doesn't offer
      stmts.push({
        sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        params: [key, JSON.stringify(value), now],
      });
    }
  } else {
    for (const table of EXPORT_TABLE_NAMES) {
      const rows = rowsOf(file, table);
      stmts.push(...inserts(table, exportColumns(table), rows.filter(isLive), true));
      stmts.push(
        ...deletions(
          table,
          rows.filter((r) => !isLive(r)),
        ),
      );
    }
  }
  await ctx.db.transaction(stmts);
}
