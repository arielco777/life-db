import { chartSeries } from './series';

const vals = (o: Record<string, number>) => new Map(Object.entries(o));

describe('chartSeries (ANL-3)', () => {
  it('one bucket per day for a month, empty after today', () => {
    const { unit, buckets } = chartSeries(
      { type: 'number' },
      vals({ '2026-08-01': 2, '2026-08-14': 3, '2026-08-20': 9 }),
      { from: '2026-08-01', to: '2026-08-31' },
      { weekStart: 'mon', today: '2026-08-14' },
    );
    expect(unit).toBe('day');
    expect(buckets).toHaveLength(31);
    expect(buckets[0]).toEqual({ from: '2026-08-01', to: '2026-08-01', value: 2 });
    expect(buckets[1]!.value).toBeNull();
    expect(buckets[13]!.value).toBe(3);
    expect(buckets[19]!.value).toBeNull(); // after today
  });

  it('weekly buckets for a year, clipped to the period, rolled up by type', () => {
    const range = { from: '2026-01-01', to: '2026-12-31' };
    // 2026-01-01 is a Thursday: the first Monday week is clipped to Jan 1–4.
    const bool = chartSeries(
      { type: 'boolean' },
      vals({ '2026-01-01': 1, '2026-01-02': 0, '2026-01-03': 1, '2026-01-05': 1 }),
      range,
      { weekStart: 'mon' },
    );
    expect(bool.unit).toBe('week');
    expect(bool.buckets[0]).toEqual({ from: '2026-01-01', to: '2026-01-04', value: 2 });
    expect(bool.buckets[1]).toEqual({ from: '2026-01-05', to: '2026-01-11', value: 1 });
    expect(bool.buckets.at(-1)).toMatchObject({ from: '2026-12-28', to: '2026-12-31' });
    expect(bool.buckets[2]!.value).toBeNull();

    const rating = chartSeries({ type: 'rating' }, vals({ '2026-01-05': 6, '2026-01-06': 9 }), range, {
      weekStart: 'mon',
    });
    expect(rating.buckets[1]!.value).toBe(7.5);
    const duration = chartSeries({ type: 'duration' }, vals({ '2026-01-05': 30, '2026-01-06': 45 }), range, {
      weekStart: 'sun',
    });
    // Sunday weeks: Jan 4–10 holds both days.
    expect(duration.buckets[1]).toEqual({ from: '2026-01-04', to: '2026-01-10', value: 75 });
  });
});
