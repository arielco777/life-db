import type { z } from 'zod';
import { DomainError } from './errors';
import { naturalId } from './ids';
import { validateEntryValue } from './schemas';
import {
  EXPORT_APP,
  EXPORT_FORMAT,
  EXPORT_TABLE_NAMES,
  exportFileSchema,
  type ExportFile,
  type ExportRow,
  type ExportTable,
} from './transfer';

/**
 * Reading an export file back (IMP-1, IMP-2, V1.5 design §4.2): everything that can be
 * checked from the file alone. References against the app's data are checked when an
 * import is planned, because a merge may point at records the app already has.
 */

/** What a record is called in messages, by table. */
export const TABLE_LABELS: Record<ExportTable, { one: string; many: string }> = {
  categories: { one: 'category', many: 'categories' },
  tags: { one: 'tag', many: 'tags' },
  habits: { one: 'habit', many: 'habits' },
  habitEntries: { one: 'habit entry', many: 'habit entries' },
  goals: { one: 'goal', many: 'goals' },
  goalMilestones: { one: 'milestone', many: 'milestones' },
  goalHabits: { one: 'goal–habit link', many: 'goal–habit links' },
  goalMonths: { one: 'goal month', many: 'goal months' },
  journalEntries: { one: 'journal entry', many: 'journal entries' },
  lifeEvents: { one: 'life event', many: 'life events' },
  entityTags: { one: 'tag link', many: 'tag links' },
};

/** Table an `entityTags.entityType` points into. */
export const TAGGED_TABLE = {
  habit: 'habits',
  goal: 'goals',
  journal_entry: 'journalEntries',
  life_event: 'lifeEvents',
} as const satisfies Record<string, ExportTable>;

/**
 * Every reference column: the table it points into, and whether a live row must have it.
 * Optional ones (`categoryId`) may be null. `entityTags.entityId` points into the table its
 * `entityType` names.
 */
export const REFERENCES: {
  [T in ExportTable]?: { column: string; to: ExportTable | 'byEntityType'; required: boolean }[];
} = {
  habits: [{ column: 'categoryId', to: 'categories', required: false }],
  habitEntries: [{ column: 'habitId', to: 'habits', required: true }],
  goals: [{ column: 'categoryId', to: 'categories', required: false }],
  goalMilestones: [{ column: 'goalId', to: 'goals', required: true }],
  goalHabits: [
    { column: 'goalId', to: 'goals', required: true },
    { column: 'habitId', to: 'habits', required: true },
  ],
  goalMonths: [{ column: 'goalId', to: 'goals', required: true }],
  journalEntries: [{ column: 'categoryId', to: 'categories', required: false }],
  lifeEvents: [{ column: 'categoryId', to: 'categories', required: false }],
  entityTags: [
    { column: 'tagId', to: 'tags', required: true },
    { column: 'entityId', to: 'byEntityType', required: true },
  ],
};

/** The table a reference points into, for this row. */
export function referencedTable(
  ref: { to: ExportTable | 'byEntityType' },
  row: Record<string, unknown>,
): ExportTable {
  return ref.to === 'byEntityType' ? TAGGED_TABLE[row.entityType as keyof typeof TAGGED_TABLE] : ref.to;
}

/** The natural ID a link or entry row must have (V1 §4.1, FC-5); null for random-ID tables. */
export function expectedNaturalId(table: ExportTable, r: Record<string, unknown>): string | null {
  const s = (k: string) => String(r[k]);
  switch (table) {
    case 'habitEntries':
      return naturalId('habit_entry', s('habitId'), s('date'));
    case 'goalHabits':
      return naturalId('goal_habit', s('goalId'), s('habitId'));
    case 'goalMonths':
      return naturalId('goal_month', s('goalId'), s('month'));
    case 'entityTags':
      return naturalId('entity_tag', s('tagId'), s('entityType'), s('entityId'));
    default:
      return null;
  }
}

const fail = (message: string): never => {
  throw new DomainError('validation', message);
};

/**
 * The field an issue is about. A row is "live record or deletion", so Zod reports a bad
 * field as a failed union on the whole row; look inside the branch that applies.
 */
function invalidField(issue: z.core.$ZodIssue, row: unknown): string | undefined {
  if (issue.path.length > 2) return typeof issue.path[2] === 'string' ? issue.path[2] : undefined;
  if (issue.code !== 'invalid_union') return undefined;
  const deleted = !!(row as { deletedAt?: unknown } | undefined)?.deletedAt;
  const branch = issue.errors[deleted ? 1 : 0]?.[0];
  return typeof branch?.path[0] === 'string' ? branch.path[0] : undefined;
}

const NOT_AN_EXPORT = 'This file isn’t a Life DB export.';

/** "habit entry #12 (2026-08-14)" — the row's position plus something a person recognises. */
function describeRow(table: ExportTable, index: number, row: unknown): string {
  const r = (row ?? {}) as Record<string, unknown>;
  const hint = [r.name, r.title, r.date, r.entryDate, r.startDate, r.month].find(
    (v) => typeof v === 'string' && v.trim(),
  ) as string | undefined;
  const label = `${TABLE_LABELS[table].one} #${index + 1}`;
  return hint ? `${label} (“${hint.length > 40 ? `${hint.slice(0, 40)}…` : hint}”)` : label;
}

/**
 * Parses and checks an export's text. Throws a DomainError('validation') with a message
 * for people when the file can't be imported (IMP-1, IMP-2). Checks: it is a Life DB
 * export of a format this app reads; every row is valid; IDs are unique per table;
 * natural IDs match their fields; habit entry values suit their habit.
 */
export function parseExport(text: string): ExportFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail(NOT_AN_EXPORT);
  }
  if (typeof raw !== 'object' || raw === null || (raw as { app?: unknown }).app !== EXPORT_APP)
    return fail(NOT_AN_EXPORT);
  const format = (raw as { format?: unknown }).format;
  if (typeof format === 'number' && format > EXPORT_FORMAT)
    return fail('This export was made by a newer version of Life DB. Update the app, then import it.');

  const parsed = exportFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues;
    const [first] = issues;
    const [table, index] = first!.path;
    const row =
      typeof table === 'string' && typeof index === 'number'
        ? (raw as Record<string, unknown[]>)[table]?.[index]
        : undefined;
    const field = invalidField(first!, row);
    const where =
      typeof table === 'string' &&
      (EXPORT_TABLE_NAMES as string[]).includes(table) &&
      typeof index === 'number'
        ? `${describeRow(table as ExportTable, index, row)}${typeof field === 'string' ? `, ${field}` : ''}`
        : first!.path.join('.') || 'the file';
    const more =
      issues.length > 1 ? ` (and ${issues.length - 1} more problem${issues.length > 2 ? 's' : ''})` : '';
    return fail(`This export can’t be imported: ${where} is invalid${more}.`);
  }
  const file = parsed.data;

  for (const table of EXPORT_TABLE_NAMES) {
    const seen = new Set<string>();
    file[table].forEach((row: ExportRow<ExportTable>, i: number) => {
      if (seen.has(row.id))
        fail(`This export can’t be imported: ${describeRow(table, i, row)} appears twice.`);
      seen.add(row.id);
      const natural = expectedNaturalId(table, row as Record<string, unknown>);
      // A different natural ID means the file was edited by hand; merging it later would
      // duplicate records instead of matching them (FC-5).
      if (natural !== null && natural !== row.id)
        fail(`This export can’t be imported: ${describeRow(table, i, row)} has an ID that doesn’t match it.`);
    });
  }

  const habits = new Map(file.habits.map((h) => [h.id, h]));
  file.habitEntries.forEach((e, i) => {
    if (!('value' in e)) return; // a deletion
    const h = habits.get(e.habitId);
    // A habit in the app only (merge) is checked by its own rules when shown; a deleted
    // habit's entries aren't shown at all.
    if (!h || !('type' in h)) return;
    try {
      validateEntryValue(
        {
          type: h.type,
          ratingScale:
            h.ratingMin !== null && h.ratingMax !== null ? { min: h.ratingMin, max: h.ratingMax } : undefined,
        },
        e.value,
      );
    } catch (err) {
      fail(`This export can’t be imported: ${describeRow('habitEntries', i, e)}: ${(err as Error).message}.`);
    }
  });
  return file;
}

// ───────── planning (IMP-3, IMP-4, IMP-6) ─────────

export type ImportMode = 'replace' | 'merge';

/** What an import does to one kind of record (IMP-6). */
export interface TableCounts {
  /** Records the app doesn't have yet. */
  add: number;
  /** Records the app has, replaced by the file's newer version. */
  update: number;
  /** Records removed: deleted by a newer deletion in the file, or (replace) everything the app had. */
  remove: number;
  /** Merge: records left as they are, because the app's version is as new or newer. */
  unchanged: number;
}

export interface ImportPlan {
  mode: ImportMode;
  /** The file as it will be written: for a merge, with same-name tags and categories combined. */
  file: ExportFile;
  counts: Record<ExportTable, TableCounts>;
  /** Merge: the file's tags and categories combined with the app's of the same name. */
  combined: { tags: number; categories: number };
  /** Deletions dropped because the record they deleted isn't anywhere (nothing to delete). */
  droppedDeletions: number;
}
