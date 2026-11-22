import type { Habit, HabitEntry } from '../types';

/**
 * Habit history as CSV for spreadsheets (EXP-2, V1.5 design §3). RFC 4180 quoting, CRLF
 * line ends and a UTF-8 byte-order mark, so Excel, LibreOffice and Google Sheets all read
 * accents and commas correctly.
 */
export type CsvLayout = 'long' | 'wide';

const BOM = '﻿';
const EOL = '\r\n';

/**
 * A text cell starting with one of these is run as a formula by spreadsheets (CSV
 * injection). Such cells get a leading apostrophe, which spreadsheets show as text.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

function quote(cell: string): string {
  return /[",\r\n]|^\s|\s$/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** User text: guarded against formulas, then quoted. */
export const textCell = (s: string | undefined): string =>
  quote(s && FORMULA_START.test(s) ? `'${s}` : (s ?? ''));

/** Values are written as stored, in the habit's own unit: booleans 1/0, durations in minutes. */
export const valueCell = (v: number): string => String(v);

/** What the value column counts in, for the long layout. */
function unitOf(h: Habit): string {
  if (h.type === 'duration') return 'minutes';
  if (h.type === 'number') return h.unit ?? '';
  return '';
}

const line = (cells: string[]) => cells.join(',') + EOL;

/**
 * `habits` in the order their columns/rows should appear; entries of other habits are
 * left out. Entries are sorted by date, then by habit order.
 */
export function habitCsv(habits: Habit[], entries: HabitEntry[], layout: CsvLayout): string {
  const order = new Map(habits.map((h, i) => [h.id, i]));
  const rows = entries
    .filter((e) => order.has(e.habitId))
    .sort((a, b) =>
      a.date === b.date ? order.get(a.habitId)! - order.get(b.habitId)! : a.date < b.date ? -1 : 1,
    );
  return BOM + (layout === 'long' ? long(habits, rows) : wide(habits, rows));
}

function long(habits: Habit[], entries: HabitEntry[]): string {
  const byId = new Map(habits.map((h) => [h.id, h]));
  let out = line(['date', 'habit', 'type', 'value', 'unit', 'note']);
  for (const e of entries) {
    const h = byId.get(e.habitId)!;
    out += line([
      e.date,
      textCell(h.name),
      h.type,
      valueCell(e.value),
      textCell(unitOf(h)),
      textCell(e.note),
    ]);
  }
  return out;
}

/** Headers for the wide layout: habit names, with ` (2)`, ` (3)`… for repeated names. */
export function uniqueHeaders(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n === 1 ? name : `${name} (${n})`;
  });
}

function wide(habits: Habit[], entries: HabitEntry[]): string {
  const col = new Map(habits.map((h, i) => [h.id, i]));
  let out = line(['date', ...uniqueHeaders(habits.map((h) => h.name)).map(textCell)]);
  let i = 0;
  while (i < entries.length) {
    const date = entries[i]!.date;
    const cells: string[] = habits.map(() => '');
    for (; i < entries.length && entries[i]!.date === date; i++)
      cells[col.get(entries[i]!.habitId)!] = valueCell(entries[i]!.value);
    out += line([date, ...cells]);
  }
  return out;
}
