import { vi } from 'vitest';
import type {
  AvailableUpdate,
  DataInfo,
  ExportFolderFile,
  ExportReadOutcome,
  LogLevel,
  FileDialogOptions,
  PlatformService,
  SaveFileOptions,
} from '@/platform/PlatformService';

/**
 * In-memory PlatformService for component tests. Set `nextSavePath` / `nextOpenPath` to
 * what the next dialog "returns" (null, the default, means the user cancels). Every call
 * is recorded on the vi.fn mocks, and `backups` lists the paths written.
 */
export function fakePlatform(info: Partial<DataInfo> = {}) {
  const state = {
    nextSavePath: null as string | null,
    nextOpenPath: null as string | null,
    /** What the next update check finds. */
    nextUpdate: null as AvailableUpdate | null,
    backups: [] as string[],
    /** What the next folder dialog "returns" (null = cancelled). */
    nextFolder: null as string | null,
    /** Export files written, by path; `password` is set for protected ones. */
    exports: new Map<string, { text: string; password?: string }>(),
    /** Folder exports written: the folder's path and its files. */
    folders: [] as { path: string; files: ExportFolderFile[] }[],
  };
  const service = {
    pickSavePath: vi.fn(async (_options: SaveFileOptions): Promise<string | null> => state.nextSavePath),
    pickOpenPath: vi.fn(async (_options: FileDialogOptions): Promise<string | null> => state.nextOpenPath),
    pickFolder: vi.fn(async (_title: string): Promise<string | null> => state.nextFolder),
    writeExport: vi.fn(async (path: string, text: string, password?: string): Promise<void> => {
      state.exports.set(path, { text, password });
    }),
    readExport: vi.fn(async (path: string, password?: string): Promise<ExportReadOutcome> => {
      const f = state.exports.get(path);
      if (!f) return { state: 'not_life_db' };
      if (f.password === undefined) return { state: 'ok', text: f.text };
      if (password === undefined) return { state: 'needs_password' };
      return password === f.password ? { state: 'ok', text: f.text } : { state: 'wrong_password' };
    }),
    writeFolder: vi.fn(async (parent: string, name: string, files: ExportFolderFile[]): Promise<string> => {
      const taken = (p: string) => state.folders.some((f) => f.path === p);
      let path = `${parent}/${name}`;
      for (let i = 2; taken(path); i++) path = `${parent}/${name} (${i})`;
      state.folders.push({ path, files });
      return path;
    }),
    revealInFolder: vi.fn(async (_path: string): Promise<void> => {}),
    backupTo: vi.fn(async (path: string): Promise<void> => {
      state.backups.push(path);
    }),
    safetyBackup: vi.fn(
      async (label: string): Promise<string> => `/home/me/.local/share/life-db/backups/${label}-1.lifedb`,
    ),
    autoBackup: vi.fn(async (_today: string, _keepCount: number): Promise<string | null> => null),
    restoreFrom: vi.fn(
      async (_path: string): Promise<string> => '/home/me/.local/share/life-db/backups/pre-restore-1.lifedb',
    ),
    reloadApp: vi.fn((): void => {}),
    appInfo: vi.fn(async () => ({
      version: '1.0.0',
      schemaVersion: 3,
      logFile: '/home/me/.local/share/life-db/logs/life-db.log',
    })),
    openInBrowser: vi.fn(async (_url: string): Promise<void> => {}),
    log: vi.fn((_level: LogLevel, _message: string): void => {}),
    checkForUpdate: vi.fn(async (): Promise<AvailableUpdate | null> => state.nextUpdate),
    restartApp: vi.fn(async (): Promise<void> => {}),
    dataInfo: vi.fn(async (): Promise<DataInfo> => ({
      path: '/home/me/.local/share/life-db/life.db',
      sizeBytes: 2_516_582,
      backupsDir: '/home/me/.local/share/life-db/backups',
      keyFile: null,
      lastAutoBackup: '2026-08-14',
      ...info,
    })),
  } satisfies PlatformService;
  return Object.assign(state, service);
}

export type FakePlatform = ReturnType<typeof fakePlatform>;
