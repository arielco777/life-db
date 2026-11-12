/** Where the database lives and how big it is (EXP-7). */
export interface DataInfo {
  /** Full path of the database file. */
  path: string;
  sizeBytes: number;
  /** Folder of automatic, pre-migration and pre-restore backups. */
  backupsDir: string;
  /** Set when the device key is kept in this file instead of the system keychain (SEC-2). */
  keyFile: string | null;
  /** Date of the newest automatic backup, or null if there is none yet (EXP-6). */
  lastAutoBackup: string | null;
}

/** About the installed app (DIST-4, DIST-6). */
export interface AppInfo {
  version: string;
  /** The newest data (schema) version this app knows. */
  schemaVersion: number;
  /** The current log file. */
  logFile: string;
}

export type LogLevel = 'error' | 'warn' | 'info';

export interface FileDialogOptions {
  title: string;
  filters: { name: string; extensions: string[] }[];
}

export interface SaveFileOptions extends FileDialogOptions {
  defaultName: string;
}

/**
 * Everything the UI needs from the device beyond the database's rows (FC-4): native file
 * dialogs, the file manager, and copying or replacing the database file. Desktop uses the
 * Tauri implementation; tests use a fake; a mobile build swaps in its own.
 */
export interface PlatformService {
  /** Asks the user where to save a file. Resolves to the chosen path, or null if cancelled. */
  pickSavePath(options: SaveFileOptions): Promise<string | null>;
  /** Asks the user to choose one file. Resolves to its path, or null if cancelled. */
  pickOpenPath(options: FileDialogOptions): Promise<string | null>;
  /** Opens the system file manager with this file selected. */
  revealInFolder(path: string): Promise<void>;
  /** Writes a consistent, encrypted copy of the database to `path` (EXP-4). */
  backupTo(path: string): Promise<void>;
  /**
   * The day's automatic backup, if it isn't there yet, then prunes to `keepCount` (EXP-6).
   * Resolves to the new file's path, or null if today's backup already existed.
   */
  autoBackup(today: string, keepCount: number): Promise<string | null>;
  /**
   * Replaces all data with the backup at `path` (EXP-5). Rejects with a message for the
   * user if the file isn't a backup from this device, is damaged, or is from a newer app
   * version. Resolves to where the replaced data was saved. The app must reload afterwards.
   */
  restoreFrom(path: string): Promise<string>;
  /** Starts the app again from the daily view, e.g. after a restore. */
  reloadApp(): void;
  dataInfo(): Promise<DataInfo>;
  appInfo(): Promise<AppInfo>;
  /** Opens a web page in the user's browser (only the project's issue tracker is allowed). */
  openInBrowser(url: string): Promise<void>;
  /**
   * Writes one line to the local log file (DIST-6). Callers must keep user content out
   * (SEC-3); `src/app/diagnostics.ts` does that for errors.
   */
  log(level: LogLevel, message: string): void;
}
