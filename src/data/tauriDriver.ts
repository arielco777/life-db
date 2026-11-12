import { invoke } from '@tauri-apps/api/core';
import type { Row, SqlDriver, SqlParam, SqlStatement } from './driver';

/** SqlDriver backed by the Rust `db_*` commands (src-tauri/src/commands.rs). */
export const tauriDriver: SqlDriver = {
  query: <T = Row>(sql: string, params: SqlParam[] = []) => invoke<T[]>('db_query', { sql, params }),
  execute: (sql: string, params: SqlParam[] = []) =>
    invoke<{ changes: number }>('db_execute', { sql, params }),
  transaction: (statements: SqlStatement[]) =>
    invoke<void>('db_transaction', {
      statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })),
    }),
  runScript: (sql: string) => invoke<void>('db_run_script', { sql }),
};

export type DbStatus =
  | { state: 'open'; path: string; createdNow: boolean; keyFallback: boolean }
  | { state: 'key_missing'; path: string }
  | { state: 'error'; message: string };

export const dbStatus = () => invoke<DbStatus>('db_status');
