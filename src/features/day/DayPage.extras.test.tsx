// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { DayRoute } from './DayPage';
import { renderWithApp } from '../../../tests/render';
import type { setup } from '../../../tests/helpers';
import { DEFAULT_CATEGORY_IDS } from '@/domain/ids';

type Repos = Awaited<ReturnType<typeof setup>>['repos'];
const THU = '2026-08-13';
const start = '2026-01-01';

const open = (seed?: (repos: Repos) => Promise<unknown>) =>
  renderWithApp(
    async ({ repos }) => {
      await seed?.(repos);
      return (
        <Routes>
          <Route path="/day/:date?" element={<DayRoute />} />
        </Routes>
      );
    },
    { route: `/day/${THU}` },
  );

describe('Daily view: group by category (tasks 5.5, DAY-4)', () => {
  it('groups by category order, keeps habit order, and remembers the choice', async () => {
    const app = await open(async (repos) => {
      await repos.habits.create({
        name: 'Budget',
        type: 'boolean',
        startDate: start,
        categoryId: DEFAULT_CATEGORY_IDS.money,
      });
      await repos.habits.create({
        name: 'Run',
        type: 'boolean',
        startDate: start,
        categoryId: DEFAULT_CATEGORY_IDS.health,
      });
      await repos.habits.create({ name: 'Loose', type: 'boolean', startDate: start });
      await repos.habits.create({
        name: 'Sleep',
        type: 'number',
        startDate: start,
        categoryId: DEFAULT_CATEGORY_IDS.health,
      });
    });
    await screen.findByRole('list', { name: 'Habits' });
    await app.user.click(screen.getByLabelText('Group by category'));

    const groups = await screen.findAllByRole('heading', { level: 3 });
    expect(groups.map((g) => g.textContent)).toEqual(['Health', 'Money', 'No category']);
    const health = screen.getByRole('list', { name: 'Health habits' });
    expect(
      within(health)
        .getAllByRole('listitem')
        .map((li) => li.querySelector('.habit-label')?.textContent),
    ).toEqual(['Run', 'Sleep']);
    await waitFor(async () => expect(await app.repos.settings.get('day.group_by_category')).toBe(true));

    await app.user.click(screen.getByLabelText('Group by category'));
    expect(await screen.findByRole('list', { name: 'Habits' })).toBeInTheDocument();
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
  });
});

describe('Daily view: quick journal (tasks 5.7)', () => {
  it('adds an entry for the day with Ctrl+Enter and lists it', async () => {
    const app = await open();
    const box = await screen.findByRole('textbox', { name: 'New journal entry for August 13' });
    expect(screen.getByRole('button', { name: 'Add entry' })).toBeDisabled();
    await app.user.type(box, 'Long walk by the river');
    await app.user.keyboard('{Control>}{Enter}{/Control}');
    const list = await screen.findByRole('list', { name: 'Journal entries' });
    expect(within(list).getByRole('link', { name: 'Long walk by the river' })).toBeInTheDocument();
    expect(box).toHaveValue('');
    expect((await app.repos.journal.forDate(THU)).map((j) => j.body)).toEqual(['Long walk by the river']);
  });
});

describe('DAY-2: a whole day, keyboard only', () => {
  it('logs 10 habits of every type and a journal line without the mouse', async () => {
    const habits: Record<string, string> = {};
    const app = await open(async (repos) => {
      const make = async (name: string, type: 'boolean' | 'number' | 'duration' | 'rating') => {
        habits[name] = (await repos.habits.create({ name, type, startDate: start })).id;
      };
      for (const n of ['Exercise', 'Read', 'Meditate', 'Floss']) await make(n, 'boolean');
      await make('Sleep', 'number');
      await make('Coffee', 'number');
      await make('Reading time', 'duration');
      await make('Screen time', 'duration');
      await make('Mood', 'rating');
      await make('Energy', 'rating');
    });
    const first = await screen.findByRole('checkbox', { name: 'Exercise, August 13' });
    await waitFor(() => expect(first).toBeEnabled());
    first.focus();
    const { user } = app;
    // Each row: the input, then its ⋯ menu button (one extra Tab). Ratings are one tab stop.
    const next = () => user.keyboard('{Tab}{Tab}');
    await user.keyboard(' ');
    await next();
    await user.keyboard(' ');
    await next();
    await next(); // skip Meditate
    await user.keyboard(' ');
    await next();
    // Number fields: −, field, +, ⋯ → Tab from the previous ⋯ lands on "−" (disabled → skipped).
    await user.keyboard('7.5{Enter}');
    await user.keyboard('{Tab}{Tab}{Tab}');
    await user.keyboard('2{Enter}');
    await user.keyboard('{Tab}{Tab}{Tab}');
    await user.keyboard('1h30{Enter}');
    await next();
    await user.keyboard('2:15{Enter}');
    await next();
    await user.keyboard('8');
    await next();
    await user.keyboard('0');
    await next();
    await user.keyboard('Good day{Control>}{Enter}{/Control}');

    await waitFor(async () => {
      const entries = await app.repos.entries.forRange({ from: THU, to: THU });
      const v = Object.fromEntries(
        entries.map((e) => [Object.keys(habits).find((k) => habits[k] === e.habitId), e.value]),
      );
      expect(v).toEqual({
        Exercise: 1,
        Read: 1,
        Floss: 1,
        Sleep: 7.5,
        Coffee: 2,
        'Reading time': 90,
        'Screen time': 135,
        Mood: 8,
        Energy: 10,
      });
    });
    await waitFor(async () => expect((await app.repos.journal.forDate(THU))[0]?.body).toBe('Good day'));
  });
});
