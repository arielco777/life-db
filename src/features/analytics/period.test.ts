import {
  comparisonPeriod,
  periodAround,
  periodFromParams,
  periodLabel,
  periodParams,
  shiftPeriod,
} from './period';

describe('analytics periods (ANL-1, ANL-2)', () => {
  it('builds the week, month and year around a date', () => {
    expect(periodAround('week', '2026-08-14', 'mon').range).toEqual({ from: '2026-08-10', to: '2026-08-16' });
    expect(periodAround('week', '2026-08-14', 'sun').range).toEqual({ from: '2026-08-09', to: '2026-08-15' });
    expect(periodAround('month', '2026-02-14', 'mon').range).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(periodAround('year', '2026-08-14', 'mon').range).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('steps through periods and compares with the one before', () => {
    const aug = periodAround('month', '2026-08-14', 'mon');
    expect(shiftPeriod(aug, -1).range).toEqual({ from: '2026-07-01', to: '2026-07-31' });
    expect(comparisonPeriod(aug).range).toEqual({ from: '2026-07-01', to: '2026-07-31' });
    expect(shiftPeriod(periodAround('year', '2026-08-14', 'mon'), 1).range.from).toBe('2027-01-01');
    const custom = { kind: 'custom' as const, range: { from: '2026-08-11', to: '2026-08-20' } };
    expect(comparisonPeriod(custom).range).toEqual({ from: '2026-08-01', to: '2026-08-10' });
    expect(shiftPeriod(custom, 1).range).toEqual({ from: '2026-08-21', to: '2026-08-30' });
  });

  it('labels periods', () => {
    expect(periodLabel(periodAround('year', '2026-08-14', 'mon'), 'yyyy-MM-dd')).toBe('2026');
    expect(periodLabel(periodAround('week', '2026-08-14', 'mon'), 'yyyy-MM-dd')).toBe('08-10 – 2026-08-16');
    expect(
      periodLabel({ kind: 'custom', range: { from: '2025-12-20', to: '2026-01-10' } }, 'yyyy-MM-dd'),
    ).toBe('2025-12-20 – 2026-01-10');
  });

  it('round-trips through the URL, defaulting to this month', () => {
    const today = '2026-08-14';
    const read = (q: string) => periodFromParams(new URLSearchParams(q), today, 'mon');
    expect(read('')).toEqual(periodAround('month', today, 'mon'));
    expect(read('period=year&from=2024-03-01').range).toEqual({ from: '2024-01-01', to: '2024-12-31' });
    expect(read('period=custom&from=2026-08-20&to=2026-08-01')).toEqual(periodAround('month', today, 'mon'));
    const custom = { kind: 'custom' as const, range: { from: '2026-08-01', to: '2026-08-20' } };
    expect(read(new URLSearchParams(periodParams(custom)).toString())).toEqual(custom);
    const week = periodAround('week', '2026-08-14', 'mon');
    expect(read(new URLSearchParams(periodParams(week)).toString())).toEqual(week);
  });
});
