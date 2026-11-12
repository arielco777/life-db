import { DATE_FORMATS, formatDate } from './dateFormat';

describe('formatDate (SET-2)', () => {
  it.each([
    ['MMM d, yyyy', 'Aug 4, 2026', 'Aug 4'],
    ['d MMM yyyy', '4 Aug 2026', '4 Aug'],
    ['yyyy-MM-dd', '2026-08-04', '08-04'],
    ['dd/MM/yyyy', '04/08/2026', '04/08'],
    ['MM/dd/yyyy', '08/04/2026', '08/04'],
    ['dd.MM.yyyy', '04.08.2026', '04.08'],
  ])('%s → %s / %s', (pattern, full, short) => {
    expect(formatDate('2026-08-04', pattern)).toBe(full);
    expect(formatDate('2026-08-04', pattern, false)).toBe(short);
  });

  it('defaults to "Aug 4, 2026", also for an unknown pattern', () => {
    expect(formatDate('2026-08-04')).toBe('Aug 4, 2026');
    expect(formatDate('2026-08-04', "yyyy 'evil'")).toBe('Aug 4, 2026');
  });

  it('never shifts the calendar date', () => {
    expect(formatDate('2026-01-01')).toBe('Jan 1, 2026');
    expect(formatDate('2026-12-31')).toBe('Dec 31, 2026');
  });

  it('offers each format once', () => {
    expect(new Set(DATE_FORMATS.map((f) => f.pattern)).size).toBe(DATE_FORMATS.length);
  });
});
