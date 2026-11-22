import { habitCsv, textCell, uniqueHeaders } from './csvExport';
import type { Habit, HabitEntry } from '../types';

const habit = (id: string, name: string, type: Habit['type'], unit?: string): Habit => ({
  id,
  name,
  type,
  unit,
  frequency: { type: 'daily' },
  priority: 'medium',
  startDate: '2026-01-01',
  sortOrder: 0,
  tagIds: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
const entry = (habitId: string, date: string, value: number, note?: string): HabitEntry => ({
  id: `${habitId}-${date}`,
  habitId,
  date,
  value,
  note,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const habits = [
  habit('g', 'Gym', 'boolean'),
  habit('r', 'Run', 'duration'),
  habit('w', 'Water', 'number', 'glasses'),
];
const entries = [
  entry('w', '2026-08-02', 8),
  entry('g', '2026-08-01', 1, 'legs, "heavy"'),
  entry('r', '2026-08-01', 35),
  entry('x', '2026-08-01', 3), // a habit not being exported
];

describe('CSV habit export (EXP-2)', () => {
  it('long layout: one row per entry, sorted by date then habit order, with a BOM and CRLF', () => {
    const csv = habitCsv(habits, entries, 'long');
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual([
      'date,habit,type,value,unit,note',
      '2026-08-01,Gym,boolean,1,,"legs, ""heavy"""',
      '2026-08-01,Run,duration,35,minutes,',
      '2026-08-02,Water,number,8,glasses,',
      '',
    ]);
  });

  it('wide layout: one row per date, one column per habit, blanks where nothing was logged', () => {
    expect(habitCsv(habits, entries, 'wide').slice(1).split('\r\n')).toEqual([
      'date,Gym,Run,Water',
      '2026-08-01,1,35,',
      '2026-08-02,,,8',
      '',
    ]);
  });

  it('keeps spreadsheets from running text as formulas, but leaves numbers alone', () => {
    expect(textCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(textCell('+1 push-up')).toBe("'+1 push-up");
    expect(textCell('@home')).toBe("'@home");
    expect(textCell('-tired')).toBe("'-tired");
    expect(textCell('Café, crème')).toBe('"Café, crème"');
    const csv = habitCsv([habit('n', '=1+1', 'number')], [entry('n', '2026-08-01', -0.5)], 'long');
    expect(csv).toContain("'=1+1,number,-0.5,");
  });

  it('gives repeated habit names distinct headers', () => {
    expect(uniqueHeaders(['Read', 'read', 'Run', 'Read'])).toEqual(['Read', 'read (2)', 'Run', 'Read (3)']);
  });
});
