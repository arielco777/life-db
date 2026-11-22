import { createHash } from 'node:crypto';
import { createNodeDriver } from './nodeDriver';
import { setup } from './helpers';
import { LATEST_SCHEMA_VERSION, migrate, MIGRATIONS } from '@/data/sqlite';
import { DEFAULT_CATEGORY_IDS } from '@/domain/ids';

/**
 * The V1.0 → V1.1 upgrade (task 15.2, DIST-3): V1.1 is a plain app update. It ships no
 * migration, never rewrites a migration 1.0 shipped, and reading a 1.0 database with the
 * V1.1 screens changes nothing in it.
 */

/** SHA-256 of each migration as released in v1.0.0 (`git show v1.0.0:<file> | sha256sum`). */
const SHIPPED_IN_1_0 = {
  1: '71ec1b22c264f2478b457a28bb956d703bd3e0c086b7bc02f19b55afdfdd2eae',
  2: 'f54d59f20273ac7bcad01376b887335d1ddc0589ecf899ec0df2a1e23d5ce7a6',
  3: '728dde80cdc9f63a5c9ecab1d775b5e3834bd9f992e3d03eb2fdccdeeff6d2d7',
} as const;

/** Every row of every table, for before/after comparison. */
function snapshot(db: ReturnType<typeof createNodeDriver>['db']) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      // Some tables (FTS internals, WITHOUT ROWID) have no rowid: compare rows as sorted JSON.
      db
        .prepare(`SELECT * FROM "${name}"`)
        .all()
        .map((r) => JSON.stringify(r))
        .sort(),
    ]),
  );
}

describe('upgrading a V1.0 database to V1.1 (task 15.2, DIST-3)', () => {
  it('ships no new migration and leaves the 1.0 migrations untouched', () => {
    expect(LATEST_SCHEMA_VERSION).toBe(3);
    expect(MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3]);
    for (const m of MIGRATIONS) {
      // Files are read as UTF-8 text; hashing the same bytes git stores.
      const sha = createHash('sha256').update(m.sql, 'utf8').digest('hex');
      expect(sha, `migration ${m.version} (${m.name}) changed since v1.0.0`).toBe(
        SHIPPED_IN_1_0[m.version as keyof typeof SHIPPED_IN_1_0],
      );
    }
  });

  it('opens a V1.0 database with real-looking data and changes nothing', async () => {
    // A database as V1.0 left it: habits, entries, journal, categories, tags, settings.
    const { driver, db, repos, clock } = await setup('2026-08-14T12:00:00');
    const travel = await repos.tags.getOrCreate('travel');
    const custom = await repos.categories.create({ name: 'Music', color: '#884488' });
    await repos.categories.archive(DEFAULT_CATEGORY_IDS.money, true);
    const run = await repos.habits.create({
      name: 'Run',
      type: 'duration',
      target: { value: 30, op: 'at_least', period: 'day' },
      categoryId: DEFAULT_CATEGORY_IDS.health,
      startDate: '2026-01-01',
      tagIds: [travel.id],
    });
    const gym = await repos.habits.create({
      name: 'Gym',
      type: 'boolean',
      frequency: { type: 'weekdays', days: ['mon', 'wed', 'fri'], restOnOtherDays: true },
      startDate: '2026-01-01',
    });
    const piano = await repos.habits.create({ name: 'Piano', type: 'rating', categoryId: custom.id });
    for (let d = 1; d <= 31; d++) {
      const date = `2026-07-${String(d).padStart(2, '0')}`;
      await repos.entries.set(run.id, date, 20 + d);
      if (d % 2) await repos.entries.set(gym.id, date, 1, d === 7 ? 'felt strong' : undefined);
    }
    await repos.entries.set(piano.id, '2026-08-14', 7);
    await repos.entries.clear(run.id, '2026-07-31');
    await repos.habits.archive(gym.id, true);
    await repos.journal.create({
      entryDate: '2026-07-04',
      title: 'Beach',
      body: 'Swam in the sea',
      tagIds: [travel.id],
    });
    const gone = await repos.journal.create({ entryDate: '2026-07-05', body: 'Deleted later' });
    await repos.journal.remove(gone.id);
    await repos.settings.set('week_start', 'sun');
    await repos.settings.set('day_start_hour', 3);
    await repos.settings.set('onboarding.completed', true);

    const before = snapshot(db);
    clock.advance(86_400_000);

    // Startup in V1.1: the migration step has nothing to do, so no pre-migration backup.
    const beforeMigrate = vi.fn();
    expect(await migrate(driver, { clock, beforeMigrate })).toEqual({ from: 3, to: 3 });
    expect(beforeMigrate).not.toHaveBeenCalled();

    // What the V1.1 screens read: goals and month goals, events and markers, search,
    // analytics' habits and entries, tag views, the daily and monthly views.
    const aug = { from: '2026-08-01', to: '2026-08-31' };
    expect(await repos.goals.list()).toEqual([]);
    expect(await repos.goals.forMonth('2026-08')).toEqual([]);
    expect(await repos.goals.forHabit(run.id)).toEqual([]);
    expect(await repos.events.list()).toEqual([]);
    expect(await repos.events.overlapping(aug)).toEqual([]);
    expect((await repos.search.search('beach')).hits.map((h) => h.title)).toEqual(['Beach']);
    expect((await repos.search.search('run')).hits.map((h) => h.id)).toEqual([run.id]);
    expect((await repos.search.search('travel')).tags).toEqual([{ id: travel.id, name: 'travel', count: 2 }]);
    expect(await repos.tags.taggedWith(travel.id)).toHaveLength(2);
    expect(await repos.habits.activeOn({ from: '2026-07-01', to: '2026-08-31' })).toHaveLength(3);
    expect(await repos.entries.forRange({ from: '2026-06-01', to: '2026-08-31' })).toHaveLength(
      31 + 16 + 1 - 1,
    );
    expect((await repos.entries.get(gym.id, '2026-07-07'))?.note).toBe('felt strong');
    expect(await repos.journal.list()).toMatchObject({ entries: [{ title: 'Beach' }] });
    expect((await repos.settings.getAll()).week_start).toBe('sun');

    expect(snapshot(db)).toEqual(before);
  });

  it('a V1.0 database opened by V1.1 still opens in V1.0 afterwards (no schema change)', async () => {
    const { driver, db } = await setup();
    const schema = () => db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all();
    const before = schema();
    await migrate(driver);
    expect(schema()).toEqual(before);
    // V1.0's runner (same migrations) sees nothing pending, so a downgrade opens it too.
    expect(await migrate(driver, { migrations: MIGRATIONS.slice(0, 3) })).toEqual({ from: 3, to: 3 });
  });
});
