import { createNodeDriver } from './nodeDriver';
import {
  currentSchemaVersion,
  DatabaseTooNewError,
  LATEST_SCHEMA_VERSION,
  migrate,
  MIGRATIONS,
} from '@/data/sqlite/migrate';
import { DEFAULT_CATEGORY_IDS } from '@/domain/ids';

describe('migrations', () => {
  it('apply from scratch and record every version', async () => {
    const driver = createNodeDriver();
    const result = await migrate(driver);
    expect(result).toEqual({ from: 0, to: LATEST_SCHEMA_VERSION });
    expect(await currentSchemaVersion(driver)).toBe(LATEST_SCHEMA_VERSION);
    const rows = await driver.query<{ version: number }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    expect(rows.map((r) => r.version)).toEqual(MIGRATIONS.map((m) => m.version));
  });

  it('are idempotent and do not call beforeMigrate when nothing is pending', async () => {
    const driver = createNodeDriver();
    await migrate(driver);
    const before = vi.fn();
    expect(await migrate(driver, { beforeMigrate: before })).toEqual({
      from: LATEST_SCHEMA_VERSION,
      to: LATEST_SCHEMA_VERSION,
    });
    expect(before).not.toHaveBeenCalled();
  });

  it('call beforeMigrate (backup hook) only when upgrading an existing DB', async () => {
    const driver = createNodeDriver();
    const fresh = vi.fn();
    await migrate(driver, { migrations: MIGRATIONS.slice(0, 1), beforeMigrate: fresh });
    expect(fresh).not.toHaveBeenCalled();
    const upgrade = vi.fn();
    await migrate(driver, { beforeMigrate: upgrade });
    expect(upgrade).toHaveBeenCalledWith(1, LATEST_SCHEMA_VERSION);
  });

  it('roll back a failing migration completely', async () => {
    const driver = createNodeDriver();
    await migrate(driver);
    const bad = {
      version: 999,
      name: 'bad',
      sql: 'CREATE TABLE half_done (x INTEGER); SELECT * FROM no_such_table;',
    };
    await expect(migrate(driver, { migrations: [...MIGRATIONS, bad] })).rejects.toThrow();
    expect(await currentSchemaVersion(driver)).toBe(LATEST_SCHEMA_VERSION);
    const t = await driver.query("SELECT name FROM sqlite_master WHERE name = 'half_done'");
    expect(t).toHaveLength(0);
  });

  it('refuse a database from a newer app version', async () => {
    const driver = createNodeDriver();
    await migrate(driver);
    await driver.execute("INSERT INTO schema_migrations VALUES (9999, 'future', '2030-01-01T00:00:00.000Z')");
    await expect(migrate(driver)).rejects.toBeInstanceOf(DatabaseTooNewError);
  });

  it('seed the 8 default categories with the fixed IDs from ids.ts', async () => {
    const driver = createNodeDriver();
    await migrate(driver);
    const cats = await driver.query<{ id: string; name: string; is_default: number }>(
      'SELECT id, name, is_default FROM categories ORDER BY sort_order',
    );
    expect(cats.map((c) => c.name)).toEqual([
      'Health',
      'Work',
      'Money',
      'Learning',
      'Relationships',
      'Home',
      'Personal',
      'Leisure',
    ]);
    expect(cats.map((c) => c.id)).toEqual(Object.values(DEFAULT_CATEGORY_IDS));
    expect(cats.every((c) => c.is_default === 1)).toBe(true);
  });

  it('enforce foreign keys', async () => {
    const driver = createNodeDriver();
    await migrate(driver);
    await expect(
      driver.execute(
        "INSERT INTO habit_entries (id, habit_id, date, value, created_at, updated_at) VALUES ('x', 'missing', '2026-01-01', 1, 'n', 'n')",
      ),
    ).rejects.toThrow(/FOREIGN KEY/);
  });
});
