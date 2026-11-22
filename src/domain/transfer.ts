import { z } from 'zod';
import { isoDate, isoMonth } from './schemas';
import type { Settings } from './types';

/**
 * The Life DB export file, format 1 (V1.5 design §2.1, EXP-1). It mirrors the tables, one
 * array per table with columns in camelCase, so it is lossless and import is plain inserts.
 * Defined once here: export output is typed by it and import parses with it.
 *
 * Deleted rows are **tombstones**: id, timestamps and their reference columns (required
 * foreign keys and natural-ID parts), never names, text, values or notes.
 */
export const EXPORT_FORMAT = 1;
export const EXPORT_APP = 'life-db';

const timestamp = z
  .string()
  .refine((s) => /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(s) && !Number.isNaN(Date.parse(s)), {
    message: 'Expected an ISO-8601 UTC timestamp',
  });
const id = z.string().min(1).max(64);
const text = z.string();
const nullable = <T extends z.ZodType>(t: T) => t.nullable();
const int = z.number().int();
const num = z.number().finite();
const priority = z.enum(['low', 'medium', 'high']);

/** One table: its SQL name, live-row columns, the columns a tombstone keeps, booleans. */
interface TableSpec<S extends z.ZodRawShape, R extends keyof S & string> {
  sql: string;
  columns: S;
  refs: readonly R[];
  booleans: readonly (keyof S & string)[];
}

const spec = <S extends z.ZodRawShape, R extends keyof S & string = never>(t: TableSpec<S, R>) => t;

/** In parent → child order: the order rows are inserted, and the file's key order. */
export const EXPORT_TABLES = {
  categories: spec({
    sql: 'categories',
    columns: {
      name: text,
      color: nullable(text),
      icon: nullable(text),
      sortOrder: int,
      isDefault: z.boolean(),
      archivedAt: nullable(timestamp),
    },
    refs: [],
    booleans: ['isDefault'],
  }),
  tags: spec({
    sql: 'tags',
    columns: { name: text, color: nullable(text) },
    refs: [],
    booleans: [],
  }),
  habits: spec({
    sql: 'habits',
    columns: {
      name: text,
      description: nullable(text),
      type: z.enum(['boolean', 'number', 'duration', 'rating']),
      unit: nullable(text),
      ratingMin: nullable(int),
      ratingMax: nullable(int),
      targetValue: nullable(num),
      targetOp: nullable(z.enum(['at_least', 'at_most'])),
      targetPeriod: nullable(z.enum(['day', 'week', 'month'])),
      frequencyType: z.enum(['daily', 'weekdays', 'times_per_week']),
      frequencyDays: nullable(int),
      frequencyCount: nullable(int),
      frequencyRest: z.boolean(),
      categoryId: nullable(id),
      priority,
      startDate: isoDate,
      endDate: nullable(isoDate),
      archivedAt: nullable(timestamp),
      sortOrder: int,
    },
    refs: [],
    booleans: ['frequencyRest'],
  }),
  habitEntries: spec({
    sql: 'habit_entries',
    columns: { habitId: id, date: isoDate, value: num, note: nullable(text) },
    refs: ['habitId', 'date'],
    booleans: [],
  }),
  goals: spec({
    sql: 'goals',
    columns: {
      title: text,
      description: nullable(text),
      categoryId: nullable(id),
      priority,
      status: z.enum(['not_started', 'active', 'paused', 'completed', 'abandoned']),
      progressMode: z.enum(['milestones', 'manual', 'numeric']),
      progressManual: nullable(num),
      progressCurrent: nullable(num),
      progressTarget: nullable(num),
      progressUnit: nullable(text),
      startDate: nullable(isoDate),
      targetDate: nullable(isoDate),
      completedAt: nullable(isoDate),
      sortOrder: int,
    },
    refs: [],
    booleans: [],
  }),
  goalMilestones: spec({
    sql: 'goal_milestones',
    columns: {
      goalId: id,
      title: text,
      targetDate: nullable(isoDate),
      completedAt: nullable(isoDate),
      sortOrder: int,
    },
    refs: ['goalId'],
    booleans: [],
  }),
  goalHabits: spec({
    sql: 'goal_habits',
    columns: { goalId: id, habitId: id },
    refs: ['goalId', 'habitId'],
    booleans: [],
  }),
  goalMonths: spec({
    sql: 'goal_months',
    columns: { goalId: id, month: isoMonth },
    refs: ['goalId', 'month'],
    booleans: [],
  }),
  journalEntries: spec({
    sql: 'journal_entries',
    columns: { entryDate: isoDate, title: nullable(text), body: text, categoryId: nullable(id) },
    refs: [],
    booleans: [],
  }),
  lifeEvents: spec({
    sql: 'life_events',
    columns: {
      name: text,
      description: nullable(text),
      startDate: isoDate,
      endDate: nullable(isoDate),
      categoryId: nullable(id),
    },
    refs: [],
    booleans: [],
  }),
  entityTags: spec({
    sql: 'entity_tags',
    columns: {
      tagId: id,
      entityType: z.enum(['habit', 'goal', 'journal_entry', 'life_event']),
      entityId: id,
    },
    refs: ['tagId', 'entityType', 'entityId'],
    booleans: [],
  }),
} as const;

export type ExportTable = keyof typeof EXPORT_TABLES;
export const EXPORT_TABLE_NAMES = Object.keys(EXPORT_TABLES) as ExportTable[];

const meta = { id, createdAt: timestamp, updatedAt: timestamp };

function rowSchemas<S extends z.ZodRawShape, R extends keyof S & string>(t: TableSpec<S, R>) {
  const live = z.object({ ...meta, ...t.columns, deletedAt: z.null() });
  const refShape = Object.fromEntries(t.refs.map((r) => [r, t.columns[r]])) as Pick<S, R>;
  const tombstone = z.object({ ...meta, ...refShape, deletedAt: timestamp });
  return { live, tombstone, row: z.union([live, tombstone]) };
}

const S = {
  categories: rowSchemas(EXPORT_TABLES.categories),
  tags: rowSchemas(EXPORT_TABLES.tags),
  habits: rowSchemas(EXPORT_TABLES.habits),
  habitEntries: rowSchemas(EXPORT_TABLES.habitEntries),
  goals: rowSchemas(EXPORT_TABLES.goals),
  goalMilestones: rowSchemas(EXPORT_TABLES.goalMilestones),
  goalHabits: rowSchemas(EXPORT_TABLES.goalHabits),
  goalMonths: rowSchemas(EXPORT_TABLES.goalMonths),
  journalEntries: rowSchemas(EXPORT_TABLES.journalEntries),
  lifeEvents: rowSchemas(EXPORT_TABLES.lifeEvents),
  entityTags: rowSchemas(EXPORT_TABLES.entityTags),
};
export const EXPORT_ROW_SCHEMAS = S;

/**
 * Preferences that travel with the data. Device settings (automatic backups, update
 * checks, first-run state) stay on the device that set them.
 */
export const PORTABLE_SETTINGS = [
  'profile.display_name',
  'week_start',
  'day_start_hour',
  'theme',
  'date_format',
  'day.group_by_category',
] as const satisfies readonly (keyof Settings)[];
export type PortableSettings = Pick<Settings, (typeof PORTABLE_SETTINGS)[number]>;

const portableSettingsSchema = z
  .object({
    'profile.display_name': z.string().max(100),
    week_start: z.enum(['mon', 'sun']),
    day_start_hour: z.number().int().min(0).max(6),
    theme: z.enum(['light', 'dark', 'system']),
    date_format: z.string().max(40),
    'day.group_by_category': z.boolean(),
  })
  .partial();

export const exportFileSchema = z.object({
  app: z.literal(EXPORT_APP),
  format: z.literal(EXPORT_FORMAT),
  schemaVersion: z.number().int().positive(),
  appVersion: z.string(),
  exportedAt: timestamp,
  settings: portableSettingsSchema,
  categories: z.array(S.categories.row),
  tags: z.array(S.tags.row),
  habits: z.array(S.habits.row),
  habitEntries: z.array(S.habitEntries.row),
  goals: z.array(S.goals.row),
  goalMilestones: z.array(S.goalMilestones.row),
  goalHabits: z.array(S.goalHabits.row),
  goalMonths: z.array(S.goalMonths.row),
  journalEntries: z.array(S.journalEntries.row),
  lifeEvents: z.array(S.lifeEvents.row),
  entityTags: z.array(S.entityTags.row),
});

export type ExportFile = z.infer<typeof exportFileSchema>;
export type ExportRow<T extends ExportTable> = ExportFile[T][number];

/** `frequency_rest` → `frequencyRest`. */
export const camelCase = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
/** `frequencyRest` → `frequency_rest`. */
export const snakeCase = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** The export columns of a table, in file order: id, the table's columns, timestamps. */
export function exportColumns(table: ExportTable): string[] {
  return ['id', ...Object.keys(EXPORT_TABLES[table].columns), 'createdAt', 'updatedAt', 'deletedAt'];
}

/**
 * A database row (snake_case, 0/1 booleans) as an export row. A deleted row keeps only
 * its id, timestamps and reference columns.
 */
export function toExportRow<T extends ExportTable>(table: T, row: Record<string, unknown>): ExportRow<T> {
  const t = EXPORT_TABLES[table];
  const deleted = row.deleted_at !== null && row.deleted_at !== undefined;
  const keep = deleted
    ? ['id', ...(t.refs as readonly string[]), 'createdAt', 'updatedAt', 'deletedAt']
    : exportColumns(table);
  const out: Record<string, unknown> = {};
  for (const key of keep) {
    const v = row[snakeCase(key)];
    out[key] = (t.booleans as readonly string[]).includes(key) ? v === 1 || v === true : (v ?? null);
  }
  return out as ExportRow<T>;
}
