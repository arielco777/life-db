import type { SqlDriver, SqlParam } from '../driver';
import { nowUtc, logicalToday, type Clock } from '@/domain/services/clock';
import type { ISODate, Timestamp } from '@/domain/types';

/** Shared dependencies for the SQLite repositories. */
export interface RepoContext {
  db: SqlDriver;
  clock: Clock;
  now(): Timestamp;
  /** Logical today using the stored day_start_hour (SET-4). */
  today(): Promise<ISODate>;
}

export function createContext(db: SqlDriver, clock: Clock): RepoContext {
  return {
    db,
    clock,
    now: () => nowUtc(clock),
    today: async () => {
      const rows = await db.query<{ value: string }>(
        "SELECT value FROM settings WHERE key = 'day_start_hour'",
      );
      const hour = rows[0] ? Number(JSON.parse(rows[0].value)) : 4;
      return logicalToday(hour, clock);
    },
  };
}

/** `undefined` → SQL NULL. */
export const n = (v: SqlParam | undefined): SqlParam => (v === undefined ? null : v);
/** SQL NULL → `undefined` (for optional domain fields). */
export const u = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);
export const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(', ');
