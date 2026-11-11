/** Where the database lives and how big it is (EXP-7). */
export interface DataInfo {
  /** Full path of the database file. */
  path: string;
  sizeBytes: number;
  /** Folder of automatic and pre-migration backups. */
  backupsDir: string;
}

export interface SaveFileOptions {
  title: string;
  defaultName: string;
  filter: { name: string; extensions: string[] };
}

/**
 * Everything the UI needs from the device beyond the database's rows (FC-4): native file
 * dialogs, the file manager, and copying the database file. Desktop uses the Tauri
 * implementation; tests use a fake; a mobile build swaps in its own.
 */
export interface PlatformService {
  /** Asks the user where to save a file. Resolves to the chosen path, or null if cancelled. */
  pickSavePath(options: SaveFileOptions): Promise<string | null>;
  /** Opens the system file manager with this file selected. */
  revealInFolder(path: string): Promise<void>;
  /** Writes a consistent, encrypted copy of the database to `path` (EXP-4). */
  backupTo(path: string): Promise<void>;
  dataInfo(): Promise<DataInfo>;
}
