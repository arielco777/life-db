import type { SqlDriver, SqlStatement } from '@/data/driver';
import { entryId } from '@/data/sqlite/repositories/entries';
import { newId } from '@/domain/ids';
import { toISODate } from '@/domain/services/clock';
import type { HabitType } from '@/domain/types';

export interface SeedOptions {
  years?: number;
  habits?: number;
  journalEntries?: number;
  /** Last day of generated data. */
  endDate?: string;
  seed?: number;
}

/** Small deterministic PRNG (mulberry32) so fixtures are reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS =
  'today felt calm busy tired happy stressed money work family friends walk coffee sleep read french recipe project run gym rain sun meeting call dinner book music trip'.split(
    ' ',
  );

/**
 * Inserts a multi-year synthetic dataset straight through SQL (fast), for NFR-1 performance checks.
 * Default: 5 years × 30 habits (~55k entries) and 3,000 journal entries.
 */
export async function seedLargeDataset(db: SqlDriver, opts: SeedOptions = {}) {
  const { years = 5, habits = 30, journalEntries = 3000, endDate = '2026-08-31', seed = 42 } = opts;
  const rand = rng(seed);
  const end = new Date(`${endDate}T12:00:00`);
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - years);
  const days: string[] = [];
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(toISODate(d));

  const now = '2026-08-31T12:00:00.000Z';
  const types: HabitType[] = ['boolean', 'number', 'duration', 'rating'];
  const habitRows = Array.from({ length: habits }, (_, i) => ({
    id: newId(),
    type: types[i % 4]!,
    name: `Habit ${i + 1}`,
  }));

  const stmts: SqlStatement[] = habitRows.map((h, i) => ({
    sql: `INSERT INTO habits (id, name, type, unit, rating_min, rating_max, start_date, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      h.id,
      h.name,
      h.type,
      h.type === 'number' ? 'units' : null,
      h.type === 'rating' ? 1 : null,
      h.type === 'rating' ? 10 : null,
      days[0]!,
      i + 1,
      now,
      now,
    ],
  }));
  await db.transaction(stmts);

  let entryCount = 0;
  for (let i = 0; i < days.length; i += 60) {
    const batch: SqlStatement[] = [];
    for (const date of days.slice(i, i + 60)) {
      for (const h of habitRows) {
        if (rand() < 0.3) continue; // ~70% logged
        const value =
          h.type === 'boolean'
            ? 1
            : h.type === 'number'
              ? Math.round(rand() * 50) / 10
              : h.type === 'duration'
                ? Math.floor(rand() * 90)
                : 1 + Math.floor(rand() * 10);
        batch.push({
          sql: 'INSERT INTO habit_entries (id, habit_id, date, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          params: [entryId(h.id, date), h.id, date, value, now, now],
        });
      }
    }
    entryCount += batch.length;
    await db.transaction(batch);
  }

  for (let i = 0; i < journalEntries; i += 500) {
    const batch: SqlStatement[] = [];
    for (let j = i; j < Math.min(i + 500, journalEntries); j++) {
      const date = days[Math.floor(rand() * days.length)]!;
      const body = Array.from(
        { length: 20 + Math.floor(rand() * 200) },
        () => WORDS[Math.floor(rand() * WORDS.length)],
      ).join(' ');
      batch.push({
        sql: 'INSERT INTO journal_entries (id, entry_date, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        params: [newId(), date, body, now, now],
      });
    }
    await db.transaction(batch);
  }

  return { habitIds: habitRows.map((h) => h.id), days: days.length, entries: entryCount, journalEntries };
}
