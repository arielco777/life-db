import { vi } from 'vitest';
import type { DataInfo, PlatformService, SaveFileOptions } from '@/platform/PlatformService';

/**
 * In-memory PlatformService for component tests. Set `nextSavePath` to what the next save
 * dialog "returns" (null, the default, means the user cancels). Every call is recorded on
 * the vi.fn mocks, and `backups` lists the paths written.
 */
export function fakePlatform(info: Partial<DataInfo> = {}) {
  const state = { nextSavePath: null as string | null, backups: [] as string[] };
  const service = {
    pickSavePath: vi.fn(async (_options: SaveFileOptions): Promise<string | null> => state.nextSavePath),
    revealInFolder: vi.fn(async (_path: string): Promise<void> => {}),
    backupTo: vi.fn(async (path: string): Promise<void> => {
      state.backups.push(path);
    }),
    dataInfo: vi.fn(async (): Promise<DataInfo> => ({
      path: '/home/me/.local/share/life-db/life.db',
      sizeBytes: 2_516_582,
      backupsDir: '/home/me/.local/share/life-db/backups',
      ...info,
    })),
  } satisfies PlatformService;
  return Object.assign(state, service);
}

export type FakePlatform = ReturnType<typeof fakePlatform>;
