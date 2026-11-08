import {
  addDays,
  addMonths,
  daysInMonth,
  diffDays,
  eachDay,
  endOfMonth,
  endOfWeek,
  intersect,
  monthRange,
  rangeLength,
  startOfWeek,
  weekdayOf,
} from './dates';

describe('dates', () => {
  it('adds days across month, year and leap boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('ignores daylight-saving transitions', () => {
    // US and EU DST changes in March/October/November 2026.
    expect(eachDay({ from: '2026-03-07', to: '2026-03-10' })).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ]);
    expect(diffDays('2026-10-24', '2026-10-26')).toBe(2);
    expect(diffDays('2026-11-01', '2026-10-31')).toBe(-1);
  });

  it('knows weekdays', () => {
    expect(weekdayOf('2026-08-14')).toBe('fri');
    expect(weekdayOf('2026-08-16')).toBe('sun');
    expect(weekdayOf('2026-08-17')).toBe('mon');
  });

  it('finds week boundaries for Monday and Sunday starts', () => {
    // Fri 2026-08-14
    expect(startOfWeek('2026-08-14', 'mon')).toBe('2026-08-10');
    expect(endOfWeek('2026-08-14', 'mon')).toBe('2026-08-16');
    expect(startOfWeek('2026-08-14', 'sun')).toBe('2026-08-09');
    expect(endOfWeek('2026-08-14', 'sun')).toBe('2026-08-15');
    // On the boundary days themselves
    expect(startOfWeek('2026-08-16', 'mon')).toBe('2026-08-10');
    expect(startOfWeek('2026-08-16', 'sun')).toBe('2026-08-16');
    expect(startOfWeek('2026-08-17', 'mon')).toBe('2026-08-17');
    // Across a year boundary
    expect(startOfWeek('2027-01-01', 'mon')).toBe('2026-12-28');
  });

  it('handles months', () => {
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
    expect(daysInMonth('2026-08')).toBe(31);
    expect(endOfMonth('2026-04-10')).toBe('2026-04-30');
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-08', -20)).toBe('2024-12');
  });

  it('works with ranges', () => {
    expect(eachDay({ from: '2026-08-02', to: '2026-08-01' })).toEqual([]);
    expect(rangeLength({ from: '2026-08-01', to: '2026-08-31' })).toBe(31);
    expect(rangeLength({ from: '2026-08-02', to: '2026-08-01' })).toBe(0);
    expect(
      intersect({ from: '2026-08-01', to: '2026-08-31' }, { from: '2026-08-20', to: '2026-09-10' }),
    ).toEqual({
      from: '2026-08-20',
      to: '2026-08-31',
    });
    expect(
      intersect({ from: '2026-08-01', to: '2026-08-10' }, { from: '2026-08-11', to: '2026-08-20' }),
    ).toBeNull();
  });
});
