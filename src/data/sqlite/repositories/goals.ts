import type { SqlParam, SqlStatement } from '../../driver';
import { n, placeholders, u, type RepoContext } from '../context';
import { clearTagsStatement, loadTagIds, setTagsStatements } from './tags';
import { DomainError } from '@/domain/errors';
import { naturalId, newId } from '@/domain/ids';
import type { GoalFilter, GoalRepository, NewGoal } from '@/domain/repositories';
import { isoMonth, newGoalSchema, newMilestoneSchema, parseOrThrow } from '@/domain/schemas';
import type { Goal, ISOMonth, Milestone, UUID } from '@/domain/types';

interface GoalRow {
  id: string;
  title: string;
  description: string | null;
  category_id: string | null;
  priority: Goal['priority'];
  status: Goal['status'];
  progress_mode: Goal['progressMode'];
  progress_manual: number | null;
  progress_current: number | null;
  progress_target: number | null;
  progress_unit: string | null;
  start_date: string | null;
  target_date: string | null;
  completed_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface MilestoneRow {
  id: string;
  goal_id: string;
  title: string;
  target_date: string | null;
  completed_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const toMilestone = (r: MilestoneRow): Milestone => ({
  id: r.id,
  goalId: r.goal_id,
  title: r.title,
  targetDate: u(r.target_date),
  completedAt: u(r.completed_at),
  sortOrder: r.sort_order,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

interface Links {
  milestones: Milestone[];
  habitIds: UUID[];
  months: ISOMonth[];
  tagIds: UUID[];
}

const toGoal = (r: GoalRow, links: Links): Goal => ({
  id: r.id,
  title: r.title,
  description: u(r.description),
  categoryId: u(r.category_id),
  priority: r.priority,
  status: r.status,
  progressMode: r.progress_mode,
  progressManual: u(r.progress_manual),
  progressCurrent: u(r.progress_current),
  progressTarget: u(r.progress_target),
  progressUnit: u(r.progress_unit),
  startDate: u(r.start_date),
  targetDate: u(r.target_date),
  completedAt: u(r.completed_at),
  sortOrder: r.sort_order,
  ...links,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const COLUMNS = [
  'title',
  'description',
  'category_id',
  'priority',
  'status',
  'progress_mode',
  'progress_manual',
  'progress_current',
  'progress_target',
  'progress_unit',
  'start_date',
  'target_date',
  'completed_at',
] as const;

type ValidGoal = ReturnType<typeof validate>;

/** Validates and fills defaults. `completedAt` is decided by the caller from the status. */
function validate(input: NewGoal) {
  const g = parseOrThrow(newGoalSchema, input);
  return {
    ...g,
    description: g.description || undefined,
    progressUnit: g.progressUnit || undefined,
    priority: g.priority ?? 'medium',
    status: g.status ?? 'active',
    progressMode: g.progressMode ?? 'milestones',
  };
}

const columnValues = (g: ValidGoal, completedAt: string | undefined): SqlParam[] => [
  g.title,
  n(g.description),
  n(g.categoryId),
  g.priority,
  g.status,
  g.progressMode,
  n(g.progressManual),
  n(g.progressCurrent),
  n(g.progressTarget),
  n(g.progressUnit),
  n(g.startDate),
  n(g.targetDate),
  n(completedAt),
];

/** Domain Goal → NewGoal-shaped input (for patching). Links are patched separately. */
const asInput = (g: Goal): NewGoal => ({
  title: g.title,
  description: g.description,
  categoryId: g.categoryId,
  priority: g.priority,
  status: g.status,
  progressMode: g.progressMode,
  progressManual: g.progressManual,
  progressCurrent: g.progressCurrent,
  progressTarget: g.progressTarget,
  progressUnit: g.progressUnit,
  startDate: g.startDate,
  targetDate: g.targetDate,
});

/** Statements making the goal's live linked habits exactly `habitIds` (FC-5 natural IDs). */
function setHabitsStatements(now: string, goalId: UUID, habitIds: readonly UUID[]): SqlStatement[] {
  const ids = [...new Set(habitIds)];
  return [
    {
      sql: `UPDATE goal_habits SET deleted_at = ?, updated_at = ?
            WHERE goal_id = ? AND deleted_at IS NULL
            ${ids.length ? `AND habit_id NOT IN (${placeholders(ids.length)})` : ''}`,
      params: [now, now, goalId, ...ids],
    },
    ...ids.map((habitId) => ({
      sql: `INSERT INTO goal_habits (id, goal_id, habit_id, created_at, updated_at, deleted_at)
            VALUES (?, ?, ?, ?, ?, NULL)
            ON CONFLICT(id) DO UPDATE SET deleted_at = NULL, updated_at = excluded.updated_at
            WHERE goal_habits.deleted_at IS NOT NULL`,
      params: [naturalId('goal_habit', goalId, habitId), goalId, habitId, now, now],
    })),
  ];
}

/** Statements making the goal's live months exactly `months` (FC-5 natural IDs). */
function setMonthsStatements(now: string, goalId: UUID, months: readonly ISOMonth[]): SqlStatement[] {
  const list = [...new Set(months)];
  return [
    {
      sql: `UPDATE goal_months SET deleted_at = ?, updated_at = ?
            WHERE goal_id = ? AND deleted_at IS NULL
            ${list.length ? `AND month NOT IN (${placeholders(list.length)})` : ''}`,
      params: [now, now, goalId, ...list],
    },
    ...list.map((month) => ({
      sql: `INSERT INTO goal_months (id, goal_id, month, created_at, updated_at, deleted_at)
            VALUES (?, ?, ?, ?, ?, NULL)
            ON CONFLICT(id) DO UPDATE SET deleted_at = NULL, updated_at = excluded.updated_at
            WHERE goal_months.deleted_at IS NOT NULL`,
      params: [naturalId('goal_month', goalId, month), goalId, month, now, now],
    })),
  ];
}

/** Rejects habit IDs that don't exist (or are deleted), so links never dangle. */
async function requireHabits(ctx: RepoContext, habitIds: readonly UUID[]) {
  const ids = [...new Set(habitIds)];
  if (!ids.length) return;
  const rows = await ctx.db.query<{ id: string }>(
    `SELECT id FROM habits WHERE deleted_at IS NULL AND id IN (${placeholders(ids.length)})`,
    ids,
  );
  if (rows.length !== ids.length) throw new DomainError('validation', 'Unknown habit');
}

export function createGoalRepository(ctx: RepoContext): GoalRepository {
  const { db } = ctx;

  /** Loads milestones, habit links, months and tags for many goals with one query each. */
  const hydrate = async (rows: GoalRow[]): Promise<Goal[]> => {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const links = new Map<UUID, Links>(
      ids.map((id) => [id, { milestones: [], habitIds: [], months: [], tagIds: [] }]),
    );
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const inChunk = `IN (${placeholders(chunk.length)})`;
      const [milestones, habits, months] = await Promise.all([
        db.query<MilestoneRow>(
          `SELECT * FROM goal_milestones WHERE deleted_at IS NULL AND goal_id ${inChunk}
           ORDER BY sort_order, created_at`,
          chunk,
        ),
        db.query<{ goal_id: string; habit_id: string }>(
          `SELECT gh.goal_id, gh.habit_id FROM goal_habits gh
           JOIN habits h ON h.id = gh.habit_id AND h.deleted_at IS NULL
           WHERE gh.deleted_at IS NULL AND gh.goal_id ${inChunk}
           ORDER BY h.sort_order, h.created_at`,
          chunk,
        ),
        db.query<{ goal_id: string; month: string }>(
          `SELECT goal_id, month FROM goal_months WHERE deleted_at IS NULL AND goal_id ${inChunk}
           ORDER BY month`,
          chunk,
        ),
      ]);
      for (const m of milestones) links.get(m.goal_id)?.milestones.push(toMilestone(m));
      for (const h of habits) links.get(h.goal_id)?.habitIds.push(h.habit_id);
      for (const m of months) links.get(m.goal_id)?.months.push(m.month);
    }
    const tags = await loadTagIds(ctx, 'goal', ids);
    return rows.map((r) => toGoal(r, { ...links.get(r.id)!, tagIds: tags.get(r.id) ?? [] }));
  };

  const get = async (id: UUID) => {
    const rows = await db.query<GoalRow>('SELECT * FROM goals WHERE id = ? AND deleted_at IS NULL', [id]);
    return rows[0] ? (await hydrate(rows))[0]! : null;
  };
  const requireGoal = async (id: UUID) => {
    const g = await get(id);
    if (!g) throw new DomainError('not_found', 'Goal not found');
    return g;
  };

  const getMilestone = async (id: UUID) => {
    const rows = await db.query<MilestoneRow>(
      `SELECT m.* FROM goal_milestones m JOIN goals g ON g.id = m.goal_id AND g.deleted_at IS NULL
       WHERE m.id = ? AND m.deleted_at IS NULL`,
      [id],
    );
    if (!rows[0]) throw new DomainError('not_found', 'Milestone not found');
    return toMilestone(rows[0]);
  };

  const ORDER = 'ORDER BY g.sort_order, g.created_at';

  return {
    async list(filter: GoalFilter = {}) {
      const where = ['g.deleted_at IS NULL'];
      const params: SqlParam[] = [];
      if (filter.status?.length) {
        where.push(`g.status IN (${placeholders(filter.status.length)})`);
        params.push(...filter.status);
      }
      if (filter.categoryId === null) where.push('g.category_id IS NULL');
      else if (filter.categoryId) {
        where.push('g.category_id = ?');
        params.push(filter.categoryId);
      }
      return hydrate(
        await db.query<GoalRow>(`SELECT g.* FROM goals g WHERE ${where.join(' AND ')} ${ORDER}`, params),
      );
    },
    get,
    async forMonth(month) {
      parseOrThrow(isoMonth, month);
      return hydrate(
        await db.query<GoalRow>(
          `SELECT g.* FROM goals g
           WHERE g.deleted_at IS NULL AND EXISTS (
             SELECT 1 FROM goal_months gm WHERE gm.goal_id = g.id AND gm.month = ? AND gm.deleted_at IS NULL)
           ${ORDER}`,
          [month],
        ),
      );
    },
    async forHabit(habitId) {
      return hydrate(
        await db.query<GoalRow>(
          `SELECT g.* FROM goals g
           WHERE g.deleted_at IS NULL AND EXISTS (
             SELECT 1 FROM goal_habits gh WHERE gh.goal_id = g.id AND gh.habit_id = ? AND gh.deleted_at IS NULL)
           ${ORDER}`,
          [habitId],
        ),
      );
    },
    async create(input) {
      const g = validate(input);
      await requireHabits(ctx, g.habitIds ?? []);
      const completedAt = g.status === 'completed' ? await ctx.today() : undefined;
      const id = newId();
      const now = ctx.now();
      await db.transaction([
        {
          sql: `INSERT INTO goals (id, ${COLUMNS.join(', ')}, sort_order, created_at, updated_at)
                VALUES (?, ${placeholders(COLUMNS.length)},
                        (SELECT coalesce(max(sort_order), 0) + 1 FROM goals WHERE deleted_at IS NULL), ?, ?)`,
          params: [id, ...columnValues(g, completedAt), now, now],
        },
        ...setTagsStatements(now, 'goal', id, g.tagIds ?? []),
        ...(g.habitIds?.length ? setHabitsStatements(now, id, g.habitIds) : []),
        ...(g.months?.length ? setMonthsStatements(now, id, g.months) : []),
      ]);
      return (await get(id))!;
    },
    async update(id, patch) {
      const current = await requireGoal(id);
      const merged = { ...asInput(current) } as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) merged[k] = v === null ? undefined : v;
      const g = validate(merged as unknown as NewGoal);
      if (patch.habitIds) await requireHabits(ctx, patch.habitIds);
      const completedAt =
        g.status !== 'completed'
          ? undefined
          : current.status === 'completed'
            ? current.completedAt
            : await ctx.today();
      const now = ctx.now();
      await db.transaction([
        {
          sql: `UPDATE goals SET ${COLUMNS.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
          params: [...columnValues(g, completedAt), now, id],
        },
        ...(patch.tagIds !== undefined ? setTagsStatements(now, 'goal', id, patch.tagIds ?? []) : []),
        ...(patch.habitIds !== undefined ? setHabitsStatements(now, id, patch.habitIds ?? []) : []),
        ...(patch.months !== undefined ? setMonthsStatements(now, id, patch.months ?? []) : []),
      ]);
      return (await get(id))!;
    },
    async remove(id) {
      const now = ctx.now();
      const soft = (table: string): SqlStatement => ({
        sql: `UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE goal_id = ? AND deleted_at IS NULL`,
        params: [now, now, id],
      });
      await db.transaction([
        soft('goal_milestones'),
        soft('goal_habits'),
        soft('goal_months'),
        clearTagsStatement(now, 'goal', id),
        {
          sql: 'UPDATE goals SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
          params: [now, now, id],
        },
      ]);
    },
    async reorder(ids) {
      const now = ctx.now();
      await db.transaction(
        ids.map((id, i) => ({
          sql: 'UPDATE goals SET sort_order = ?, updated_at = ? WHERE id = ?',
          params: [i + 1, now, id],
        })),
      );
    },

    async addMilestone(goalId, input) {
      await requireGoal(goalId);
      const m = parseOrThrow(newMilestoneSchema, input);
      const id = newId();
      const now = ctx.now();
      await db.execute(
        `INSERT INTO goal_milestones (id, goal_id, title, target_date, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?,
                 (SELECT coalesce(max(sort_order), 0) + 1 FROM goal_milestones
                  WHERE goal_id = ? AND deleted_at IS NULL), ?, ?)`,
        [id, goalId, m.title, n(m.targetDate), goalId, now, now],
      );
      return getMilestone(id);
    },
    async updateMilestone(id, patch) {
      const current = await getMilestone(id);
      const merged: Record<string, unknown> = { title: current.title, targetDate: current.targetDate };
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) merged[k] = v === null ? undefined : v;
      const m = parseOrThrow(newMilestoneSchema, merged);
      await db.execute('UPDATE goal_milestones SET title = ?, target_date = ?, updated_at = ? WHERE id = ?', [
        m.title,
        n(m.targetDate),
        ctx.now(),
        id,
      ]);
      return getMilestone(id);
    },
    async setMilestoneDone(id, done) {
      const current = await getMilestone(id);
      if (!!current.completedAt === done) return current;
      await db.execute('UPDATE goal_milestones SET completed_at = ?, updated_at = ? WHERE id = ?', [
        done ? await ctx.today() : null,
        ctx.now(),
        id,
      ]);
      return getMilestone(id);
    },
    async reorderMilestones(goalId, ids) {
      const now = ctx.now();
      await db.transaction(
        ids.map((id, i) => ({
          sql: 'UPDATE goal_milestones SET sort_order = ?, updated_at = ? WHERE id = ? AND goal_id = ?',
          params: [i + 1, now, id, goalId],
        })),
      );
    },
    async removeMilestone(id) {
      const now = ctx.now();
      const { changes } = await db.execute(
        'UPDATE goal_milestones SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
        [now, now, id],
      );
      if (!changes) throw new DomainError('not_found', 'Milestone not found');
    },

    async setHabits(goalId, habitIds) {
      await requireGoal(goalId);
      await requireHabits(ctx, habitIds);
      await db.transaction(setHabitsStatements(ctx.now(), goalId, habitIds));
    },
    async setMonths(goalId, months) {
      await requireGoal(goalId);
      for (const m of months) parseOrThrow(isoMonth, m);
      await db.transaction(setMonthsStatements(ctx.now(), goalId, months));
    },
  };
}
