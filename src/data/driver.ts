/** Values that can be bound to SQL parameters. Booleans must be converted to 0/1 first. */
export type SqlParam = string | number | null;
export type Row = Record<string, unknown>;

export interface SqlStatement {
  sql: string;
  params?: SqlParam[];
}

/**
 * The narrow seam between repositories and SQLite (design §3.4).
 * Production: Rust commands over rusqlite/SQLCipher. Tests: better-sqlite3.
 */
export interface SqlDriver {
  query<T = Row>(sql: string, params?: SqlParam[]): Promise<T[]>;
  execute(sql: string, params?: SqlParam[]): Promise<{ changes: number }>;
  /** Runs all statements atomically; rolls back everything on any error (NFR-3). */
  transaction(statements: SqlStatement[]): Promise<void>;
  /** Runs a multi-statement SQL script (migrations) atomically. */
  runScript(sql: string): Promise<void>;
}

/** True when an error from either driver is a UNIQUE-constraint violation. */
export const isUniqueViolation = (e: unknown): boolean =>
  String((e as { message?: unknown })?.message ?? e).includes('UNIQUE constraint failed');
