import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import * as logger from '@tauri-apps/plugin-log';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';
import type { AppInfo, AvailableUpdate, DataInfo, PlatformService } from './PlatformService';
import { LATEST_SCHEMA_VERSION } from '@/data/sqlite';

/** Tauri rejects with the Rust error's message as a plain string; keep it as an Error's message. */
function call<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((e: unknown) => {
    throw e instanceof Error ? e : new Error(String(e));
  });
}

/** Desktop PlatformService over Tauri plugins and the Rust `db_*` commands. */
export const tauriPlatform: PlatformService = {
  pickSavePath: ({ title, defaultName, filters }) => call(save({ title, defaultPath: defaultName, filters })),
  pickOpenPath: ({ title, filters }) => call(open({ title, filters, multiple: false, directory: false })),
  revealInFolder: (path) => call(revealItemInDir(path)),
  backupTo: (destPath) => call(invoke<void>('db_backup', { destPath })),
  autoBackup: (today, keepCount) => call(invoke<string | null>('db_auto_backup', { today, keepCount })),
  // Backups from a newer app (a higher schema version) are refused.
  restoreFrom: (srcPath) =>
    call(invoke<string>('db_restore', { srcPath, maxVersion: LATEST_SCHEMA_VERSION })),
  reloadApp: () => {
    window.location.hash = '#/';
    window.location.reload();
  },
  dataInfo: () => call(invoke<DataInfo>('db_info')),
  appInfo: async (): Promise<AppInfo> => ({
    version: await call(getVersion()),
    schemaVersion: LATEST_SCHEMA_VERSION,
    logFile: await call(invoke<string>('app_log_file')),
  }),
  openInBrowser: (url) => call(openUrl(url)),
  log: (level, message) => {
    // Never let logging itself throw into the caller.
    void logger[level](message).catch(() => {});
  },
  checkForUpdate: async (): Promise<AvailableUpdate | null> => {
    const update = await call(check());
    if (!update) return null;
    return {
      version: update.version,
      notes: update.body ?? '',
      install: (onProgress) => {
        let total: number | undefined;
        let done = 0;
        return call(
          update.downloadAndInstall((e) => {
            if (e.event === 'Started') total = e.data.contentLength;
            if (e.event === 'Progress') done += e.data.chunkLength;
            onProgress?.(e.event === 'Finished' ? 1 : total ? Math.min(done / total, 1) : null);
          }),
        );
      },
    };
  },
  restartApp: () => call(relaunch()),
};
