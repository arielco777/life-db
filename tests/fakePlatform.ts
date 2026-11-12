import { vi } from 'vitest';
import type {
  DataInfo,
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
    backups: [] as string[],
  };
  const service = {
    pickSavePath: vi.fn(async (_options: SaveFileOptions): Promise<string | null> => state.nextSavePath),
    pickOpenPath: vi.fn(async (_options: FileDialogOptions): Promise<string | null> => state.nextOpenPath),
    revealInFolder: vi.fn(async (_path: string): Promise<void> => {}),
    backupTo: vi.fn(async (path: string): Promise<void> => {
      state.backups.push(path);
    }),
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
