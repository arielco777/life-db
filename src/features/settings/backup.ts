import type { ISODate } from '@/domain/types';

/** Extension of manual backups (design §6.9). */
export const BACKUP_EXTENSION = 'lifedb';

/** Suggested name in the save dialog: `life-db-YYYY-MM-DD.lifedb`. */
export const backupFileName = (today: ISODate) => `life-db-${today}.${BACKUP_EXTENSION}`;

/**
 * Some save dialogs (GTK on Linux) don't add the filter's extension when the user types a
 * bare name. A name with no extension gets `.lifedb`; a name the user gave one keeps it.
 */
export function withBackupExtension(path: string): string {
  const name = path.split(/[/\\]/).pop() ?? '';
  return name.replace(/^\.+/, '').includes('.') ? path : `${path}.${BACKUP_EXTENSION}`;
}

/** 2516582 → "2.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
