import type { RepoContext } from '../context';
import { LATEST_SCHEMA_VERSION } from '../migrate';
import type { SettingsRepository } from '@/domain/repositories';
import {
  EXPORT_APP,
  EXPORT_FORMAT,
  EXPORT_TABLE_NAMES,
  EXPORT_TABLES,
  PORTABLE_SETTINGS,
  toExportRow,
  type ExportFile,
  type PortableSettings,
} from '@/domain/transfer';

/**
 * Every row of every data table, deleted ones as tombstones, plus the portable
 * preferences (EXP-1, V1.5 design §2.2). Rows are sorted by id, so exporting the same
 * data twice gives identical files.
 */
export async function exportAll(
  ctx: RepoContext,
  settingsRepo: SettingsRepository,
  appVersion: string,
): Promise<ExportFile> {
  const all = await settingsRepo.getAll();
  const settings = Object.fromEntries(PORTABLE_SETTINGS.map((k) => [k, all[k]])) as PortableSettings;
  const file: Record<string, unknown> = {
    app: EXPORT_APP,
    format: EXPORT_FORMAT,
    schemaVersion: LATEST_SCHEMA_VERSION,
    appVersion,
    exportedAt: ctx.now(),
    settings,
  };
  for (const table of EXPORT_TABLE_NAMES) {
    const rows = await ctx.db.query<Record<string, unknown>>(
      `SELECT * FROM ${EXPORT_TABLES[table].sql} ORDER BY id`,
    );
    file[table] = rows.map((r) => toExportRow(table, r));
  }
  return file as ExportFile;
}
