import type { SqlParam } from '../../driver';
import { n, u, type RepoContext } from '../context';
import { clearTagsStatement, loadTagIds, setTagsStatements } from './tags';
import { DomainError } from '@/domain/errors';
import { newId } from '@/domain/ids';
import type { HabitRepository, NewHabit } from '@/domain/repositories';
import { newHabitSchema, parseOrThrow } from '@/domain/schemas';
import type { Habit, HabitFrequency, Weekday } from '@/domain/types';
import { WEEKDAYS } from '@/domain/types';

interface HabitRow {
  id: string;
  name: string;
  description: string | null;
  type: Habit['type'];
  unit: string | null;
  rating_min: number | null;
  rating_max: number | null;
  target_value: number | null;
  target_op: 'at_least' | 'at_most' | null;
  target_period: 'day' | 'week' | 'month' | null;
  frequency_type: HabitFrequency['type'];
  frequency_days: number | null;
  frequency_count: number | null;
  frequency_rest: number;
  category_id: string | null;
  priority: Habit['priority'];
  start_date: string;
  end_date: string | null;
  archived_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export const weekdaysToMask = (days: readonly Weekday[]) =>
  days.reduce((m, d) => m | (1 << WEEKDAYS.indexOf(d)), 0);
export const maskToWeekdays = (mask: number): Weekday[] => WEEKDAYS.filter((_, i) => mask & (1 << i));

function toFrequency(r: HabitRow): HabitFrequency {
  switch (r.frequency_type) {
    case 'weekdays':
      return {
        type: 'weekdays',
        days: maskToWeekdays(r.frequency_days ?? 0),
        ...(r.frequency_rest ? { restOnOtherDays: true } : {}),
      };
    case 'times_per_week':
      return { type: 'times_per_week', count: r.frequency_count ?? 1 };
    default:
      return { type: 'daily' };
  }
}

const toHabit = (r: HabitRow, tagIds: string[]): Habit => ({
  id: r.id,
  name: r.name,
  description: u(r.description),
  type: r.type,
  unit: u(r.unit),
  ratingScale:
    r.type === 'rating' && r.rating_min !== null && r.rating_max !== null
      ? { min: r.rating_min, max: r.rating_max }
      : undefined,
  target:
    r.target_value !== null && r.target_op && r.target_period
      ? { value: r.target_value, op: r.target_op, period: r.target_period }
      : undefined,
  frequency: toFrequency(r),
  categoryId: u(r.category_id),
  priority: r.priority,
  startDate: r.start_date,
  endDate: u(r.end_date),
  archivedAt: u(r.archived_at),
  sortOrder: r.sort_order,
  tagIds,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

type ValidHabit = ReturnType<typeof normalize>;

/** Validates input and applies type-specific defaults/clean-up. */
function normalize(input: NewHabit, today: string) {
  const h = parseOrThrow(newHabitSchema, input);
  return {
    ...h,
    unit: h.type === 'number' ? h.unit || undefined : undefined,
    ratingScale: h.type === 'rating' ? (h.ratingScale ?? { min: 1, max: 10 }) : undefined,
    frequency: (h.frequency ?? { type: 'daily' }) as HabitFrequency,
    priority: h.priority ?? 'medium',
    startDate: h.startDate ?? today,
  };
}

/** Column values shared by INSERT and UPDATE, in COLUMNS order. */
const COLUMNS = [
  'name',
  'description',
  'type',
  'unit',
  'rating_min',
  'rating_max',
  'target_value',
  'target_op',
  'target_period',
  'frequency_type',
  'frequency_days',
  'frequency_count',
  'frequency_rest',
  'category_id',
  'priority',
  'start_date',
  'end_date',
] as const;

const columnValues = (h: ValidHabit): SqlParam[] => [
  h.name,
  n(h.description),
  h.type,
  n(h.unit),
  n(h.ratingScale?.min),
  n(h.ratingScale?.max),
  n(h.target?.value),
  n(h.target?.op),
  n(h.target?.period),
  h.frequency.type,
  h.frequency.type === 'weekdays' ? weekdaysToMask(h.frequency.days) : null,
  h.frequency.type === 'times_per_week' ? h.frequency.count : null,
  h.frequency.type === 'weekdays' && h.frequency.restOnOtherDays ? 1 : 0,
  n(h.categoryId),
  h.priority,
  h.startDate,
  n(h.endDate),
];

/** Domain Habit → NewHabit-shaped input (for patching). */
const asInput = (h: Habit): NewHabit => ({
  name: h.name,
  description: h.description,
  type: h.type,
  unit: h.unit,
  ratingScale: h.ratingScale,
  target: h.target,
  frequency: h.frequency,
  categoryId: h.categoryId,
  priority: h.priority,
  startDate: h.startDate,
  endDate: h.endDate,
  tagIds: h.tagIds,
});

export function createHabitRepository(ctx: RepoContext): HabitRepository {
  const { db } = ctx;

  const hydrate = async (rows: HabitRow[]) => {
    const tags = await loadTagIds(
      ctx,
      'habit',
      rows.map((r) => r.id),
    );
    return rows.map((r) => toHabit(r, tags.get(r.id) ?? []));
  };
  const get = async (id: string) => {
    const rows = await db.query<HabitRow>('SELECT * FROM habits WHERE id = ? AND deleted_at IS NULL', [id]);
    return rows[0] ? (await hydrate(rows))[0]! : null;
  };
  const hasEntries = async (id: string) =>
    (await db.query('SELECT 1 FROM habit_entries WHERE habit_id = ? AND deleted_at IS NULL LIMIT 1', [id]))
      .length > 0;

  return {
    async list({ includeArchived = false } = {}) {
      const rows = await db.query<HabitRow>(
        `SELECT * FROM habits WHERE deleted_at IS NULL ${includeArchived ? '' : 'AND archived_at IS NULL'}
         ORDER BY sort_order, created_at`,
      );
      return hydrate(rows);
    },
    async activeOn({ from, to }) {
      const rows = await db.query<HabitRow>(
        `SELECT * FROM habits h
         WHERE h.deleted_at IS NULL
           AND h.start_date <= ? AND (h.end_date IS NULL OR h.end_date >= ?)
           AND (h.archived_at IS NULL OR EXISTS (
                 SELECT 1 FROM habit_entries e
                 WHERE e.habit_id = h.id AND e.deleted_at IS NULL AND e.date BETWEEN ? AND ?))
         ORDER BY h.sort_order, h.created_at`,
        [to, from, from, to],
      );
      return hydrate(rows);
    },
    get,
    hasEntries,
    async create(input) {
      const h = normalize(input, await ctx.today());
      const id = newId();
      const now = ctx.now();
      await db.transaction([
        {
          sql: `INSERT INTO habits (id, ${COLUMNS.join(', ')}, sort_order, created_at, updated_at)
                VALUES (?, ${COLUMNS.map(() => '?').join(', ')},
                        (SELECT coalesce(max(sort_order), 0) + 1 FROM habits WHERE deleted_at IS NULL), ?, ?)`,
          params: [id, ...columnValues(h), now, now],
        },
        ...setTagsStatements(now, 'habit', id, h.tagIds ?? []),
      ]);
      return (await get(id))!;
    },
    async update(id, patch) {
      const current = await get(id);
      if (!current) throw new DomainError('not_found', 'Habit not found');
      const typeChanges = !!patch.type && patch.type !== current.type;
      const scaleChanges =
        current.type === 'rating' &&
        patch.ratingScale !== undefined &&
        (patch.ratingScale?.min !== current.ratingScale?.min ||
          patch.ratingScale?.max !== current.ratingScale?.max);
      if ((typeChanges || scaleChanges) && (await hasEntries(id)))
        throw new DomainError(
          'type_locked',
          typeChanges
            ? 'The type of a habit with entries cannot be changed. Archive it and create a new one.'
            : 'The rating scale of a habit with entries cannot be changed. Archive it and create a new one.',
        );
      const merged = { ...asInput(current) } as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) merged[k] = v === null ? undefined : v;
      const h = normalize(merged as unknown as NewHabit, current.startDate);
      const now = ctx.now();
      await db.transaction([
        {
          sql: `UPDATE habits SET ${COLUMNS.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
          params: [...columnValues(h), now, id],
        },
        ...(patch.tagIds !== undefined ? setTagsStatements(now, 'habit', id, patch.tagIds ?? []) : []),
      ]);
      return (await get(id))!;
    },
    async archive(id, archived) {
      const now = ctx.now();
      const { changes } = await db.execute(
        'UPDATE habits SET archived_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
        [archived ? now : null, now, id],
      );
      if (!changes) throw new DomainError('not_found', 'Habit not found');
    },
    async remove(id) {
      const now = ctx.now();
      await db.transaction([
        {
          sql: 'UPDATE habit_entries SET deleted_at = ?, updated_at = ? WHERE habit_id = ? AND deleted_at IS NULL',
          params: [now, now, id],
        },
        {
          sql: 'UPDATE goal_habits SET deleted_at = ?, updated_at = ? WHERE habit_id = ? AND deleted_at IS NULL',
          params: [now, now, id],
        },
        clearTagsStatement(now, 'habit', id),
        {
          sql: 'UPDATE habits SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
          params: [now, now, id],
        },
      ]);
    },
    async reorder(ids) {
      const now = ctx.now();
      await db.transaction(
        ids.map((id, i) => ({
          sql: 'UPDATE habits SET sort_order = ?, updated_at = ? WHERE id = ?',
          params: [i + 1, now, id],
        })),
      );
    },
  };
}
