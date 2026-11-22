import { statRows } from './statRows';

const rows = (r: ReturnType<typeof statRows>) => Object.fromEntries(r.map((x) => [x.label, x.value]));

describe('statRows (ANL-1)', () => {
  it('boolean: completion, done of expected, streaks not compared', () => {
    const r = statRows(
      { type: 'boolean' },
      {
        type: 'boolean',
        done: 18,
        expected: 31,
        completion: 18 / 31,
        currentStreak: 1,
        longestStreak: 6,
        streakUnit: 'day',
      },
      'en',
    );
    expect(rows(r)).toEqual({
      Completion: '58%',
      Done: '18 of 31',
      'Current streak': '1 day',
      'Longest streak': '6 days',
    });
    expect(r.filter((x) => !x.comparable).map((x) => x.key)).toEqual(['current', 'longest']);
  });

  it('number with a unit, and nothing logged', () => {
    expect(
      rows(
        statRows(
          { type: 'number', unit: 'cups' },
          { type: 'number', daysLogged: 3, min: 1, max: 4, total: 7.5, average: 2.5 },
          'en',
        ),
      ),
    ).toEqual({
      Average: '2.5 cups',
      Total: '7.5 cups',
      Lowest: '1 cups',
      Highest: '4 cups',
      'Days logged': '3',
    });
    expect(
      rows(
        statRows(
          { type: 'number' },
          { type: 'number', daysLogged: 0, min: null, max: null, total: null, average: null },
          'en',
        ),
      ),
    ).toMatchObject({ Average: '–', Total: '–' });
  });

  it('duration and rating', () => {
    expect(
      rows(
        statRows(
          { type: 'duration' },
          {
            type: 'duration',
            daysLogged: 2,
            min: 30,
            max: 90,
            total: 120,
            averagePerLoggedDay: 60,
            averagePerCalendarDay: 4,
          },
          'en',
        ),
      ),
    ).toEqual({ Total: '2h', 'Average per logged day': '1h', 'Average per day': '4m', 'Days logged': '2' });
    expect(
      rows(
        statRows({ type: 'rating' }, { type: 'rating', daysLogged: 4, min: 5, max: 9, average: 7.25 }, 'en'),
      ),
    ).toEqual({ Average: '7.3', Lowest: '5', Highest: '9', 'Days logged': '4' });
  });
});
