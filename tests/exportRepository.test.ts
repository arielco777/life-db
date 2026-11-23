import { setup } from './helpers';
import { DEFAULT_CATEGORY_IDS } from '@/domain/ids';
import {
  EXPORT_TABLE_NAMES,
  EXPORT_TABLES,
  exportColumns,
  exportFileSchema,
  PORTABLE_SETTINGS,
  snakeCase,
} from '@/domain/transfer';

async function seeded() {
  const s = await setup('2026-08-14T12:00:00');
  const { repos, clock } = s;
  const travel = await repos.tags.getOrCreate('travel');
  const music = await repos.categories.create({ name: 'Music', color: '#884488' });
  const run = await repos.habits.create({
    name: 'Run',
    type: 'duration',
    target: { value: 30, op: 'at_least', period: 'day' },
    categoryId: DEFAULT_CATEGORY_IDS.health,
    frequency: { type: 'weekdays', days: ['mon', 'wed'], restOnOtherDays: true },
    startDate: '2026-01-01',
    tagIds: [travel.id],
  });
  await repos.entries.set(run.id, '2026-08-10', 35, 'felt strong');
  clock.advance();
  await repos.entries.set(run.id, '2026-08-12', 20);
  await repos.entries.clear(run.id, '2026-08-12');
  const goal = await repos.goals.create({ title: 'Read 20 books', habitIds: [run.id], months: ['2026-08'] });
  await repos.goals.addMilestone(goal.id, { title: 'First 5' });
  await repos.journal.create({ entryDate: '2026-08-13', title: 'Beach', body: 'Swam', tagIds: [travel.id] });
  const secret = await repos.journal.create({ entryDate: '2026-08-14', body: 'My private diary text' });
  await repos.journal.remove(secret.id);
  await repos.events.create({ name: 'Trip to Lyon', startDate: '2026-07-01', endDate: '2026-07-05' });
  await repos.settings.set('week_start', 'sun');
  await repos.settings.set('backup.keep_count', 30);
  return { ...s, run, goal, secret, music, travel };
}

describe('JSON export (EXP-1, V1.5 design §2.1)', () => {
  it('covers every column of every data table, and nothing else', async () => {
    const { db } = await setup();
    for (const table of EXPORT_TABLE_NAMES) {
      const cols = (db.prepare(`PRAGMA table_info(${EXPORT_TABLES[table].sql})`).all() as { name: string }[])
        .map((c) => c.name)
        .sort();
      expect(exportColumns(table).map(snakeCase).sort(), table).toEqual(cols);
    }
    // Every data table is exported (schema_migrations, settings and FTS tables aren't data rows).
    const tables = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'search_index%' AND sql NOT LIKE '%VIRTUAL%'",
        )
        .all() as { name: string }[]
    ).map((t) => t.name);
    expect(tables.filter((t) => !['schema_migrations', 'settings'].includes(t)).sort()).toEqual(
      EXPORT_TABLE_NAMES.map((t) => EXPORT_TABLES[t].sql).sort(),
    );
  });

  it('exports every record in a file that parses with the schema', async () => {
    const { repos, run, goal, travel, music } = await seeded();
    const file = await repos.transfer.exportAll({ appVersion: '1.5.0' });
    expect(exportFileSchema.safeParse(file).error).toBeUndefined();
    expect(file).toMatchObject({ app: 'life-db', format: 1, schemaVersion: 3, appVersion: '1.5.0' });
    expect(file.exportedAt).toMatch(/^2026-08-1[45]T\d\d:00:01.000Z$/);

    expect(file.categories).toHaveLength(9);
    expect(file.categories.find((c) => c.id === DEFAULT_CATEGORY_IDS.health)).toMatchObject({
      isDefault: true,
    });
    expect(file.categories.find((c) => c.id === music.id)).toMatchObject({ name: 'Music', isDefault: false });
    expect(file.habits).toEqual([
      expect.objectContaining({
        id: run.id,
        type: 'duration',
        targetValue: 30,
        targetOp: 'at_least',
        frequencyType: 'weekdays',
        frequencyRest: true,
        categoryId: DEFAULT_CATEGORY_IDS.health,
        deletedAt: null,
      }),
    ]);
    expect(file.habitEntries.find((e) => e.date === '2026-08-10')).toMatchObject({
      value: 35,
      note: 'felt strong',
    });
    expect(file.goals).toEqual([expect.objectContaining({ id: goal.id, title: 'Read 20 books' })]);
    expect(file.goalMilestones).toHaveLength(1);
    expect(file.goalHabits).toEqual([expect.objectContaining({ goalId: goal.id, habitId: run.id })]);
    expect(file.goalMonths).toEqual([expect.objectContaining({ goalId: goal.id, month: '2026-08' })]);
    expect(file.lifeEvents).toEqual([
      expect.objectContaining({ name: 'Trip to Lyon', endDate: '2026-07-05' }),
    ]);
    expect(file.tags).toEqual([expect.objectContaining({ id: travel.id, name: 'travel' })]);
    expect(file.entityTags.map((t) => t.entityType).sort()).toEqual(['habit', 'journal_entry']);
  });

  it('writes deleted records as tombstones with no content', async () => {
    const { repos, run, secret } = await seeded();
    const file = await repos.transfer.exportAll({ appVersion: '1.5.0' });
    const cleared = file.habitEntries.find((e) => e.date === '2026-08-12')!;
    expect(Object.keys(cleared).sort()).toEqual([
      'createdAt',
      'date',
      'deletedAt',
      'habitId',
      'id',
      'updatedAt',
    ]);
    expect(cleared).toMatchObject({ habitId: run.id, deletedAt: expect.any(String) });
    const gone = file.journalEntries.find((j) => j.id === secret.id)!;
    expect(Object.keys(gone).sort()).toEqual(['createdAt', 'deletedAt', 'id', 'updatedAt']);
    expect(JSON.stringify(file)).not.toContain('My private diary text');
  });

  it('carries preferences but not device settings', async () => {
    const { repos } = await seeded();
    const file = await repos.transfer.exportAll({ appVersion: '1.5.0' });
    expect(Object.keys(file.settings).sort()).toEqual([...PORTABLE_SETTINGS].sort());
    expect(file.settings.week_start).toBe('sun');
    expect(JSON.stringify(file.settings)).not.toContain('backup');
  });

  it('sorts rows by id, so the same data always gives the same file', async () => {
    const { repos } = await seeded();
    const a = await repos.transfer.exportAll({ appVersion: '1.5.0' });
    const b = await repos.transfer.exportAll({ appVersion: '1.5.0' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (const t of EXPORT_TABLE_NAMES) {
      const ids = a[t].map((r) => r.id);
      expect(ids, t).toEqual([...ids].sort());
    }
  });
});
