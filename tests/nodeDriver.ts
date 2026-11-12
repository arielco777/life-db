import Database from 'better-sqlite3';
import type { Row, SqlDriver, SqlParam, SqlStatement } from '@/data/driver';

/**
 * Test-only SqlDriver on better-sqlite3 (NFR-10). Same SQL as production, no encryption
 * (encryption is covered by the Rust tests).
 */
export function createNodeDriver(
  filename = ':memory:',
): SqlDriver & { db: Database.Database; close(): void } {
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  const run = (sql: string, params: SqlParam[] = []) => db.prepare(sql).run(...params);

  return {
    db,
    close: () => db.close(),
    async query<T = Row>(sql: string, params: SqlParam[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async execute(sql: string, params: SqlParam[] = []) {
      return { changes: run(sql, params).changes };
    },
    async transaction(statements: SqlStatement[]) {
      db.transaction(() => {
        for (const s of statements) run(s.sql, s.params);
      })();
    },
    async runScript(sql: string) {
      db.exec('BEGIN');
      try {
        db.exec(sql);
        db.exec('COMMIT');
      } catch (e) {
        if (db.inTransaction) db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
