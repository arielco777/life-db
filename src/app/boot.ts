import { invoke, isTauri } from '@tauri-apps/api/core';
import { createRepositories, DatabaseTooNewError, migrate } from '@/data/sqlite';
import { dbStatus, tauriDriver, type DbStatus } from '@/data/tauriDriver';
import type { Repositories } from '@/domain/repositories';
import { toISODate } from '@/domain/services/clock';
import { dailyBackup } from '@/features/settings/backup';
import { tauriPlatform } from '@/platform/tauriPlatform';

export type BootResult =
  | { kind: 'ready'; repos: Repositories; status: Extract<DbStatus, { state: 'open' }> }
  | { kind: 'no-tauri' }
  | { kind: 'key-missing'; path: string }
  | { kind: 'too-new'; dbVersion: number; appVersion: number }
  | { kind: 'error'; message: string };

/** Opens the database, applies migrations (with a pre-migration backup), builds repositories. */
export async function boot(): Promise<BootResult> {
  if (!isTauri()) return { kind: 'no-tauri' };
  try {
    const status = await dbStatus();
    if (status.state === 'key_missing') return { kind: 'key-missing', path: status.path };
    if (status.state === 'error') return { kind: 'error', message: status.message };

    await migrate(tauriDriver, {
      // NFR-3 / DIST-3: back up before touching an existing database's schema.
      beforeMigrate: async (from, to) => {
        await invoke<string>('db_backup_internal', { label: `pre-migration-v${from}-to-v${to}` });
      },
    });
    const repos = createRepositories(tauriDriver);
    // EXP-6: in the background, so startup doesn't wait on the copy.
    void repos.settings
      .getAll()
      .then((settings) => dailyBackup(tauriPlatform, settings, toISODate(new Date())))
      .catch((e: unknown) => console.error('Automatic backup failed:', e instanceof Error ? e.message : e));
    return { kind: 'ready', repos, status };
  } catch (e) {
    if (e instanceof DatabaseTooNewError)
      return { kind: 'too-new', dbVersion: e.dbVersion, appVersion: e.appVersion };
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
