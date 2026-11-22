// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { Route, Routes } from 'react-router-dom';
import { GoalRoutes } from './GoalPages';
import { renderWithApp } from '../../../tests/render';
import type { setup } from '../../../tests/helpers';
import { logicalToday } from '@/domain/services/clock';
import { addDays, monthOf } from '@/domain/services/dates';
import { DayRoute } from '@/features/day/DayPage';
import { HabitRoutes } from '@/features/habits/HabitPages';
import { monthTitle } from '@/features/month/labels';
import { MonthRoute } from '@/features/month/MonthPage';
import { SettingsPage } from '@/features/settings/SettingsPage';

// The daily and monthly views show goals only in V1.1 builds.
vi.mock('@/app/features', () => ({ FEATURE_V1_1: true, SHOW_DEBUG: false }));

type Repos = Awaited<ReturnType<typeof setup>>['repos'];

const today = logicalToday(4);
const thisMonth = monthOf(today);

async function open(route: string, seed?: (repos: Repos) => Promise<unknown>) {
  return renderWithApp(
    async ({ repos }) => {
      await repos.settings.set('onboarding.completed', true);
      await seed?.(repos);
      return (
        <main>
          <Routes>
            <Route path="/goals/*" element={<GoalRoutes />} />
            <Route path="/habits/*" element={<HabitRoutes />} />
            <Route path="/day/:date?" element={<DayRoute />} />
            <Route path="/month/:ym?" element={<MonthRoute />} />
            <Route path="/settings/*" element={<SettingsPage />} />
          </Routes>
        </main>
      );
    },
    { route },
  );
}

describe('Linked habits (tasks 11.6, GOAL-5)', () => {
  it('links a habit, shows its stats for this month, and unlinks it', async () => {
    let goalId = '';
    const app = await open('/goals', async (repos) => {
      const study = await repos.habits.create({
        name: 'Study French',
        type: 'boolean',
        startDate: '2020-01-01',
      });
      await repos.habits.create({ name: 'Run', type: 'boolean', startDate: '2020-01-01' });
      await repos.entries.set(study.id, today, 1);
      goalId = (await repos.goals.create({ title: 'Learn French' })).id;
    });
    await app.user.click(await screen.findByRole('link', { name: 'Learn French' }));
    await app.user.selectOptions(await screen.findByLabelText('Habit to link'), 'Study French');
    await app.user.click(screen.getByRole('button', { name: 'Link habit' }));

    const list = await screen.findByRole('list', { name: 'Linked habits' });
    expect(within(list).getByRole('link', { name: 'Study French' })).toBeInTheDocument();
    // This month's summary, as in the monthly grid: 1 done.
    expect(within(list).getByText(new RegExp(`^${monthTitle(thisMonth)}: 1/`))).toBeInTheDocument();
    // Already linked habits aren't offered again.
    expect(
      within(screen.getByLabelText('Habit to link')).queryByRole('option', { name: 'Study French' }),
    ).toBeNull();

    await app.user.click(within(list).getByRole('button', { name: 'Unlink Study French' }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Linked habits' })).toBeNull());
    expect((await app.repos.goals.get(goalId))!.habitIds).toEqual([]);
  });

  it('the habit page lists the goals it serves', async () => {
    const app = await open('/habits', async (repos) => {
      const h = await repos.habits.create({ name: 'Study French', type: 'boolean' });
      await repos.goals.create({ title: 'Learn French', habitIds: [h.id] });
      await repos.goals.create({ title: 'Move to Lyon', habitIds: [h.id] });
      await repos.goals.create({ title: 'Unrelated' });
    });
    await app.user.click(await screen.findByRole('link', { name: 'Study French' }));
    expect(await screen.findByRole('link', { name: 'Learn French' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/goals\//),
    );
    expect(screen.getByRole('link', { name: 'Move to Lyon' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Unrelated' })).toBeNull();
  });
});

describe('Month goals (tasks 11.7, GOAL-6, MON-7)', () => {
  it('assigns months on the goal page', async () => {
    let goalId = '';
    const app = await open('/goals', async (repos) => {
      goalId = (await repos.goals.create({ title: 'Read 3 books' })).id;
    });
    await app.user.click(await screen.findByRole('link', { name: 'Read 3 books' }));
    // This month is suggested first.
    await app.user.click(await screen.findByRole('button', { name: 'Add month' }));
    const months = await screen.findByRole('list', { name: 'Months' });
    expect(within(months).getByRole('link', { name: monthTitle(thisMonth) })).toHaveAttribute(
      'href',
      `/month/${thisMonth}`,
    );
    // The picker moves on to the next month.
    await app.user.click(screen.getByRole('button', { name: 'Add month' }));
    await waitFor(async () => expect((await app.repos.goals.get(goalId))!.months).toHaveLength(2));

    await app.user.click(screen.getByRole('button', { name: `Remove ${monthTitle(thisMonth)}` }));
    await waitFor(async () => expect((await app.repos.goals.get(goalId))!.months).not.toContain(thisMonth));
  });

  it('lists the month’s goals under the grid, adds new and existing ones, and removes one', async () => {
    const app = await open(`/month/${thisMonth}`, async (repos) => {
      await repos.habits.create({ name: 'Run', type: 'boolean', startDate: '2020-01-01' });
      await repos.goals.create({
        title: 'Read 3 books',
        progressMode: 'numeric',
        progressCurrent: 1,
        progressTarget: 3,
        months: [thisMonth],
      });
      await repos.goals.create({ title: 'Finish project', status: 'completed', months: [thisMonth] });
      await repos.goals.create({ title: 'Learn French' });
      await repos.goals.create({ title: 'Old goal', status: 'abandoned' });
    });
    const name = (await screen.findByRole('heading', { name: /^Goals for / })).textContent!.replace(
      'Goals for ',
      '',
    );
    const list = await screen.findByRole('list', { name: `Goals for ${name}` });
    expect(
      within(list)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Read 3 books', 'Finish project']);
    expect(within(list).getByText('Completed')).toBeInTheDocument();
    expect(within(list).getByRole('progressbar', { name: 'Read 3 books progress' })).toHaveAttribute(
      'aria-valuetext',
      '1 / 3',
    );

    await app.user.type(screen.getByLabelText(`New goal for ${name}`), 'Learn a recipe');
    await app.user.click(screen.getByRole('button', { name: 'Add monthly goal' }));
    await within(list).findByRole('link', { name: 'Learn a recipe' });

    // Only unfinished goals not already in the month are offered.
    const existing = screen.getByLabelText(`Add an existing goal to ${name}`);
    expect(
      within(existing)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Add an existing goal…', 'Learn French']);
    await app.user.selectOptions(existing, 'Learn French');
    await within(list).findByRole('link', { name: 'Learn French' });

    await app.user.click(within(list).getByRole('button', { name: `Remove Finish project from ${name}` }));
    await waitFor(() => expect(within(list).queryByRole('link', { name: 'Finish project' })).toBeNull());
    expect((await app.repos.goals.forMonth(thisMonth)).map((g) => g.title)).toEqual([
      'Read 3 books',
      'Learn French',
      'Learn a recipe',
    ]);
  });
});

describe('Daily view goals (tasks 11.8, DAY-1, GOAL-5)', () => {
  it('shows active goals with habits on the day, and each habit’s status', async () => {
    await open(`/day/${today}`, async (repos) => {
      const study = await repos.habits.create({
        name: 'Study French',
        type: 'duration',
        startDate: '2020-01-01',
      });
      const podcast = await repos.habits.create({
        name: 'Podcast',
        type: 'boolean',
        startDate: '2020-01-01',
      });
      const run = await repos.habits.create({ name: 'Run', type: 'boolean', startDate: '2020-01-01' });
      // A habit that ended before today isn't on the day, so its goal isn't either.
      const old = await repos.habits.create({
        name: 'Old',
        type: 'boolean',
        startDate: '2020-01-01',
        endDate: addDays(today, -10),
      });
      await repos.entries.set(study.id, today, 30);
      const fr = await repos.goals.create({ title: 'Learn French', habitIds: [study.id, podcast.id] });
      await repos.goals.addMilestone(fr.id, { title: 'A1' });
      await repos.goals.create({ title: 'Be fit', status: 'paused', habitIds: [run.id] });
      await repos.goals.create({ title: 'Past', habitIds: [old.id] });
      await repos.goals.create({ title: 'No habits' });
    });
    const section = await screen.findByRole('list', { name: 'Goals' });
    expect(
      within(section)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Learn French']);
    const habits = within(section).getByRole('list', { name: 'Habits for Learn French' });
    expect(
      within(habits)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Study French: 30m', 'Podcast: Not logged']);
    expect(within(section).getByRole('progressbar', { name: 'Learn French progress' })).toHaveAttribute(
      'aria-valuetext',
      '0/1',
    );
  });

  it('has no goals section when no goal has habits that day', async () => {
    await open(`/day/${today}`, async (repos) => {
      await repos.habits.create({ name: 'Run', type: 'boolean', startDate: '2020-01-01' });
      await repos.goals.create({ title: 'Learn French' });
    });
    await screen.findByRole('list', { name: 'Habits' });
    expect(screen.queryByRole('heading', { name: 'Goals' })).toBeNull();
  });
});

describe('Goals in tag views (tasks 11.9, TAG-1, TAG-5)', () => {
  it('lists goals carrying the tag, with their status when not active', async () => {
    const app = await open('/settings/tags', async (repos) => {
      const tag = await repos.tags.getOrCreate('france');
      await repos.goals.create({ title: 'Visit Paris', status: 'completed', tagIds: [tag.id] });
      await repos.goals.create({ title: 'Learn French', tagIds: [tag.id] });
      await repos.habits.create({ name: 'Study French', type: 'boolean', tagIds: [tag.id] });
    });
    await app.user.click(await screen.findByRole('link', { name: /france/ }));
    const goals = await screen.findByRole('list', { name: 'Goals' });
    expect(
      within(goals)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Learn French', 'Visit Pariscompleted']);
    expect(screen.getByRole('list', { name: 'Habits' })).toBeInTheDocument();
  });
});

describe('Accessibility with goals shown (axe, NFR-7)', () => {
  const violations = async () =>
    (await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } })).violations.map(
      (v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    );
  const seed = async (repos: Repos) => {
    const h = await repos.habits.create({ name: 'Study French', type: 'boolean', startDate: '2020-01-01' });
    const g = await repos.goals.create({ title: 'Learn French', habitIds: [h.id], months: [thisMonth] });
    await repos.goals.addMilestone(g.id, { title: 'A1' });
    await repos.goals.create({ title: 'Garden', progressMode: 'manual', progressManual: 30 });
  };

  it('daily view', async () => {
    await open(`/day/${today}`, seed);
    await screen.findByRole('list', { name: 'Habits for Learn French' }, { timeout: 5000 });
    expect(await violations()).toEqual([]);
  });

  it('monthly view', async () => {
    await open(`/month/${thisMonth}`, seed);
    await screen.findByRole('link', { name: 'Learn French' }, { timeout: 5000 });
    await screen.findByLabelText(/^Add an existing goal/);
    expect(await violations()).toEqual([]);
  });

  it('goal page with linked habits and months', async () => {
    const app = await open('/goals', seed);
    await app.user.click(await screen.findByRole('link', { name: 'Learn French' }));
    await screen.findByRole('list', { name: 'Months' });
    await screen.findByRole('list', { name: 'Linked habits' });
    expect(await violations()).toEqual([]);
  });
});
