// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { boot, type BootDeps } from './boot';
import { BootScreen } from './BootScreen';
import { fakePlatform } from '../../tests/fakePlatform';
import { createNodeDriver } from '../../tests/nodeDriver';
import { MIGRATIONS, migrate } from '@/data/sqlite';

/** An existing database at the current version, plus an update whose new migration fails. */
async function upgradeThatFails() {
  const driver = createNodeDriver();
  await migrate(driver);
  await driver.execute(
    "INSERT INTO settings (key, value, updated_at) VALUES ('profile.display_name', '\"Kept\"', '2026-01-01T00:00:00Z')",
  );
  const latest = MIGRATIONS.at(-1)!.version;
  const broken = [
    ...MIGRATIONS,
    { version: latest + 1, name: 'adds_things', sql: 'CREATE TABLE new_things (id TEXT);' },
    { version: latest + 2, name: 'breaks', sql: 'ALTER TABLE no_such_table ADD COLUMN x TEXT;' },
  ];
  const platform = fakePlatform();
  const backups: string[] = [];
  const deps: BootDeps = {
    inTauri: () => true,
    status: async () => ({ state: 'open', path: '/data/life.db', createdNow: false, keyFallback: false }),
    driver,
    backup: async (label) => backups.push(label),
    platform,
    migrations: broken,
  };
  return { driver, deps, backups, platform, latest };
}

describe('a failed update migration (task 10.4, DIST-3)', () => {
  it('backs up first, keeps the data, and reports migration-failed', async () => {
    const { driver, deps, backups, platform, latest } = await upgradeThatFails();
    const result = await boot(deps);

    expect(result).toMatchObject({ kind: 'migration-failed', backedUp: true });
    expect(backups).toEqual([`pre-migration-v${latest}-to-v${latest + 2}`]);
    // The whole update was rolled back, including the step that worked: the database is
    // exactly as before, so the previous app version can still open it.
    const version = await driver.query<{ v: number }>('SELECT max(version) AS v FROM schema_migrations');
    expect(version[0]!.v).toBe(latest);
    const added = await driver.query<{ n: number }>(
      "SELECT count(*) AS n FROM sqlite_master WHERE name = 'new_things'",
    );
    expect(added[0]!.n).toBe(0);
    const kept = await driver.query<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'profile.display_name'",
    );
    expect(kept[0]!.value).toBe('"Kept"');
    expect(platform.log).toHaveBeenCalledWith(
      'error',
      expect.stringMatching(/^Startup failed \(migration-failed\)/),
    );
  });

  it('shows a recovery screen with the backups folder, a report link and the log', async () => {
    const { deps } = await upgradeThatFails();
    const result = await boot(deps);
    const platform = fakePlatform();
    const user = userEvent.setup();
    render(<BootScreen result={result} platform={platform} />);

    expect(
      screen.getByRole('heading', { name: 'Life DB couldn’t finish updating your data' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      /your data is exactly as it was, and a copy was also saved/,
    );
    await user.click(screen.getByRole('button', { name: 'Open backups folder' }));
    expect(platform.revealInFolder).toHaveBeenCalledWith('/home/me/.local/share/life-db/backups');
    await user.click(screen.getByRole('button', { name: 'Report an issue' }));
    const url = platform.openInBrowser.mock.calls[0]![0];
    expect(decodeURIComponent(url)).toContain('Migration failed:');
    await user.click(screen.getByRole('button', { name: 'Open log file' }));
    expect(platform.revealInFolder).toHaveBeenLastCalledWith(
      '/home/me/.local/share/life-db/logs/life-db.log',
    );
  });

  it('an up-to-date database boots normally', async () => {
    const { deps } = await upgradeThatFails();
    const result = await boot({ ...deps, migrations: undefined });
    expect(result.kind).toBe('ready');
  });
});
