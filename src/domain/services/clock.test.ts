import { isISODate, logicalDateOf, logicalToday, toISODate } from './clock';

const at = (iso: string) => new Date(iso); // local time (no Z)

describe('logical date (SET-4)', () => {
  it('counts hours before the day start as the previous day', () => {
    expect(logicalDateOf(at('2026-08-15T01:30:00'), 4)).toBe('2026-08-14');
    expect(logicalDateOf(at('2026-08-15T03:59:59'), 4)).toBe('2026-08-14');
    expect(logicalDateOf(at('2026-08-15T04:00:00'), 4)).toBe('2026-08-15');
  });

  it('midnight start means the calendar date', () => {
    expect(logicalDateOf(at('2026-08-15T00:10:00'), 0)).toBe('2026-08-15');
  });

  it('rolls back across month and year boundaries', () => {
    expect(logicalDateOf(at('2026-03-01T02:00:00'), 4)).toBe('2026-02-28');
    expect(logicalDateOf(at('2028-03-01T02:00:00'), 4)).toBe('2028-02-29'); // leap year
    expect(logicalDateOf(at('2027-01-01T03:00:00'), 4)).toBe('2026-12-31');
  });

  it('logicalToday reads the injected clock', () => {
    expect(logicalToday(4, { now: () => at('2026-08-15T02:00:00') })).toBe('2026-08-14');
  });
});

describe('date helpers', () => {
  it('formats local dates', () => {
    expect(toISODate(at('2026-01-05T23:59:00'))).toBe('2026-01-05');
  });

  it('validates real calendar dates only', () => {
    expect(isISODate('2026-08-14')).toBe(true);
    expect(isISODate('2028-02-29')).toBe(true);
    expect(isISODate('2026-02-29')).toBe(false);
    expect(isISODate('2026-13-01')).toBe(false);
    expect(isISODate('2026-8-14')).toBe(false);
    expect(isISODate('2026-08-14T00:00')).toBe(false);
  });
});
