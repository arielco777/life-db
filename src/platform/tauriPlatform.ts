import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import type { DataInfo, PlatformService } from './PlatformService';

/** Tauri rejects with the Rust error's message as a plain string; keep it as an Error's message. */
function call<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((e: unknown) => {
    throw e instanceof Error ? e : new Error(String(e));
  });
}

/** Desktop PlatformService over Tauri plugins and the Rust `db_*` commands. */
export const tauriPlatform: PlatformService = {
  pickSavePath: ({ title, defaultName, filter }) =>
    call(save({ title, defaultPath: defaultName, filters: [filter] })),
  revealInFolder: (path) => call(revealItemInDir(path)),
  backupTo: (destPath) => call(invoke<void>('db_backup', { destPath })),
  dataInfo: () => call(invoke<DataInfo>('db_info')),
};
