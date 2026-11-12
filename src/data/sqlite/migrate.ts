import type { SqlDriver } from '../driver';
import { nowUtc, systemClock, type Clock } from '@/domain/services/clock';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const files = import.meta.glob('./migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Bundled migrations, sorted by version. File names: `NNNN_name.sql`. */
export const MIGRATIONS: Migration[] = Object.entries(files)
  .map(([path, sql]) => {
    const m = /\/(\d{4})_([\w-]+)\.sql$/.exec(path);
    if (!m) throw new Error(`Bad migration file name: ${path}`);
    return { version: Number(m[1]), name: m[2]!, sql };
  })
  .sort((a, b) => a.version - b.version);

export const LATEST_SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0;

export class DatabaseTooNewError extends Error {
  constructor(
    readonly dbVersion: number,
    readonly appVersion: number,
  ) {
    super(`Database schema v${dbVersion} is newer than this app supports (v${appVersion}). Update the app.`);
    this.name = 'DatabaseTooNewError';
  }
}

export async function currentSchemaVersion(driver: SqlDriver): Promise<number> {
  const exists = await driver.query<{ n: number }>(
    "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  );
  if (!exists[0]?.n) return 0;
  const rows = await driver.query<{ v: number | null }>('SELECT max(version) AS v FROM schema_migrations');
  return rows[0]?.v ?? 0;
}

export interface MigrateOptions {
  migrations?: Migration[];
  clock?: Clock;
  /** Called once before migrating an existing (non-empty) DB, e.g. to take a backup (NFR-3). */
  beforeMigrate?: (fromVersion: number, toVersion: number) => Promise<void>;
}

/**
 * Applies all pending migrations, with their schema_migrations rows, in one transaction.
 * Refuses to touch a DB created by a newer app version.
 */
export async function migrate(
  driver: SqlDriver,
  { migrations = MIGRATIONS, clock = systemClock, beforeMigrate }: MigrateOptions = {},
): Promise<{ from: number; to: number }> {
  const latest = migrations.at(-1)?.version ?? 0;
  const from = await currentSchemaVersion(driver);
  if (from > latest) throw new DatabaseTooNewError(from, latest);

  const pending = migrations.filter((m) => m.version > from);
  if (pending.length === 0) return { from, to: from };
  if (from > 0 && beforeMigrate) await beforeMigrate(from, latest);

  // All pending migrations in ONE transaction (DIST-3): if any step fails, the database
  // stays exactly at `from`, so the previous app version can still open it. Migrations must
  // therefore be transaction-safe (no PRAGMA foreign_keys, VACUUM or BEGIN/COMMIT).
  const appliedAt = nowUtc(clock);
  const script = pending
    .map(
      (m) =>
        `${m.sql}\n;\nINSERT INTO schema_migrations (version, name, applied_at) VALUES (${m.version}, '${m.name.replace(/'/g, "''")}', '${appliedAt}');`,
    )
    .join('\n');
  await driver.runScript(script);
  return { from, to: latest };
}
