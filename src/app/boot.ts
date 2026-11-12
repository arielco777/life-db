import { invoke, isTauri } from '@tauri-apps/api/core';
import { describeError } from './diagnostics';
import { afterInteractive } from './startup';
import type { SqlDriver } from '@/data/driver';
import { createRepositories, DatabaseTooNewError, migrate } from '@/data/sqlite';
import type { Migration } from '@/data/sqlite/migrate';
import { dbStatus, tauriDriver, type DbStatus } from '@/data/tauriDriver';
import type { Repositories } from '@/domain/repositories';
import { toISODate } from '@/domain/services/clock';
import { dailyBackup } from '@/features/settings/backup';
import type { PlatformService } from '@/platform/PlatformService';
import { tauriPlatform } from '@/platform/tauriPlatform';

export type BootResult =
  | { kind: 'ready'; repos: Repositories; status: Extract<DbStatus, { state: 'open' }> }
  | { kind: 'no-tauri' }
  | { kind: 'key-missing'; path: string }
  | { kind: 'too-new'; dbVersion: number; appVersion: number }
  /** DIST-3: an update's migrations failed and were all rolled back; the data is unchanged. */
  | { kind: 'migration-failed'; message: string; backedUp: boolean }
  | { kind: 'error'; message: string };

/** What boot needs from the outside world; tests pass their own. */
export interface BootDeps {
  inTauri(): boolean;
  status(): Promise<DbStatus>;
  driver: SqlDriver;
  /** Pre-migration backup into the backups folder (NFR-3). */
  backup(label: string): Promise<unknown>;
  platform: Pick<PlatformService, 'log' | 'autoBackup'>;
  migrations?: Migration[];
}

const tauriDeps: BootDeps = {
  inTauri: isTauri,
  status: dbStatus,
  driver: tauriDriver,
  backup: (label) => invoke<string>('db_backup_internal', { label }),
  platform: tauriPlatform,
};

/** Opens the database, applies migrations (with a pre-migration backup), builds repositories. */
export async function boot(deps: BootDeps = tauriDeps): Promise<BootResult> {
  if (!deps.inTauri()) return { kind: 'no-tauri' };
  const fail = (result: Exclude<BootResult, { kind: 'ready' | 'no-tauri' }>, e?: unknown) => {
    deps.platform.log(
      'error',
      `Startup failed (${result.kind})${e === undefined ? '' : `: ${describeError(e)}`}`,
    );
    return result;
  };
  try {
    const status = await deps.status();
    if (status.state === 'key_missing') return fail({ kind: 'key-missing', path: status.path });
    if (status.state === 'error') return fail({ kind: 'error', message: status.message });

    let backedUp = false;
    try {
      await migrate(deps.driver, {
        migrations: deps.migrations,
        // NFR-3 / DIST-3: back up before touching an existing database's schema.
        beforeMigrate: async (from, to) => {
          await deps.backup(`pre-migration-v${from}-to-v${to}`);
          backedUp = true;
        },
      });
    } catch (e) {
      if (e instanceof DatabaseTooNewError)
        return fail({ kind: 'too-new', dbVersion: e.dbVersion, appVersion: e.appVersion });
      return fail(
        { kind: 'migration-failed', message: e instanceof Error ? e.message : String(e), backedUp },
        e,
      );
    }

    const repos = createRepositories(deps.driver);
    // EXP-6: in the background, after the first screen is up. The copy holds the database
    // while it runs, so starting it during startup would delay the daily view (NFR-1).
    afterInteractive(() => {
      void repos.settings
        .getAll()
        .then((settings) => dailyBackup(deps.platform, settings, toISODate(new Date())))
        .catch((e: unknown) => deps.platform.log('error', `Automatic backup failed: ${describeError(e)}`));
    });
    return { kind: 'ready', repos, status };
  } catch (e) {
    return fail({ kind: 'error', message: e instanceof Error ? e.message : String(e) }, e);
  }
}
