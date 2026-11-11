import { summaryLines } from './summary';

describe('summaryLines (MON-4)', () => {
  const en = 'en-US';
  it('boolean: done/expected and percent', () => {
    expect(
      summaryLines(
        {},
        {
          type: 'boolean',
          done: 18,
          expected: 31,
          completion: 18 / 31,
          currentStreak: 0,
          longestStreak: 3,
          streakUnit: 'day',
        },
        en,
      ),
    ).toEqual({ main: '18/31', sub: '58%', label: '18 of 31 scheduled days done (58%)' });
    expect(
      summaryLines(
        {},
        {
          type: 'boolean',
          done: 0,
          expected: 0,
          completion: null,
          currentStreak: 0,
          longestStreak: 0,
          streakUnit: 'day',
        },
        en,
      ).sub,
    ).toBeUndefined();
  });
  it('number: average, plus total with a unit', () => {
    const s = { type: 'number' as const, daysLogged: 3, total: 7, average: 7 / 3, min: 1, max: 4 };
    expect(summaryLines({ unit: 'cups' }, s, en)).toEqual({
      main: 'avg 2.3',
      sub: '7 cups',
      label: 'Average 2.3, total 7 cups',
    });
    expect(summaryLines({}, s, en).sub).toBeUndefined();
    expect(summaryLines({}, { ...s, daysLogged: 0, total: null, average: null }, en).main).toBe('–');
  });
  it('duration: total and per calendar day', () => {
    const s = {
      type: 'duration' as const,
      daysLogged: 20,
      total: 763,
      min: 30,
      max: 50,
      averagePerLoggedDay: 38,
      averagePerCalendarDay: 763 / 31,
    };
    expect(summaryLines({}, s, en)).toEqual({
      main: '12h43',
      sub: '25m/d',
      label: 'Total 12h 43m, 25m per day',
    });
    expect(summaryLines({}, { ...s, daysLogged: 0, total: 0 }, en).main).toBe('–');
  });
  it('rating: average', () => {
    expect(summaryLines({}, { type: 'rating', daysLogged: 2, average: 7.25, min: 6, max: 8 }, en)).toEqual({
      main: 'avg 7.3',
      label: 'Average 7.3',
    });
  });

  it('flags rest days the habit was done on anyway (HAB-5)', () => {
    const s = {
      type: 'boolean',
      done: 12,
      expected: 13,
      completion: 12 / 13,
      currentStreak: 1,
      longestStreak: 5,
      streakUnit: 'day',
    } as const;
    expect(summaryLines({}, s, en, 2)).toEqual({
      main: '12/13',
      sub: '92% ⚠ 2',
      label: '12 of 13 scheduled days done (92%); done on 2 rest days',
    });
    expect(summaryLines({}, { ...s, completion: null }, en, 1).sub).toBe('⚠ 1');
  });
});
