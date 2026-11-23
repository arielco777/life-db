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

/** A newer version on the update server (DIST-2). */
export interface AvailableUpdate {
  version: string;
  /** Release notes (Markdown), '' if none. */
  notes: string;
  /**
   * Downloads, verifies the signature and installs the update. `onProgress` gets 0–1, or
   * null while the size is unknown. The app must restart afterwards (`restartApp`).
   */
  install(onProgress?: (fraction: number | null) => void): Promise<void>;
}

export type LogLevel = 'error' | 'warn' | 'info';

export interface FileDialogOptions {
  title: string;
  filters: { name: string; extensions: string[] }[];
}

export interface SaveFileOptions extends FileDialogOptions {
  defaultName: string;
}

/** What reading an export file found (IMP-1). */
export type ExportReadOutcome =
  | { state: 'ok'; text: string }
  | { state: 'needs_password' }
  | { state: 'wrong_password' }
  | { state: 'not_life_db' };

/** One file of a folder export (EXP-3). `name` is a single, portable file name. */
export interface ExportFolderFile {
  name: string;
  text: string;
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
  /** Asks the user to choose a folder. Resolves to its path, or null if cancelled. */
  pickFolder(title: string): Promise<string | null>;
  /**
   * Writes an export file, replacing `path` only once the whole file is written. With a
   * password, the file is encrypted (EXP-8); the password is never stored or logged.
   */
  writeExport(path: string, text: string, password?: string): Promise<void>;
  /** Reads an export file, decrypting it with `password` if it is protected (IMP-1). */
  readExport(path: string, password?: string): Promise<ExportReadOutcome>;
  /**
   * Creates a new folder `name` inside `parent` (`name (2)`… if taken) and writes the
   * files into it, never overwriting anything (EXP-3). Resolves to the folder's path.
   */
  writeFolder(parent: string, name: string, files: ExportFolderFile[]): Promise<string>;
  /** Opens the system file manager with this file selected. */
  revealInFolder(path: string): Promise<void>;
  /**
   * Saves a copy of the database in the backups folder as `<label>-<time>.lifedb`, never
   * pruned (e.g. `pre-import`, IMP-5). Resolves to its path, for undoing with `restoreFrom`.
   */
  safetyBackup(label: string): Promise<string>;
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
  /** Asks the update server for a newer version (DIST-2). Null when up to date. */
  checkForUpdate(): Promise<AvailableUpdate | null>;
  /** Restarts the app, e.g. into an installed update. */
  restartApp(): Promise<void>;
}
