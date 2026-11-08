// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { DayRoute } from './DayPage';
import { renderWithApp } from '../../../tests/render';
import type { setup } from '../../../tests/helpers';
import { logicalToday } from '@/domain/services/clock';
import { addDays } from '@/domain/services/dates';

type Repos = Awaited<ReturnType<typeof setup>>['repos'];
const THU = '2026-08-13';

function Where() {
  return <output aria-label="path">{useLocation().pathname}</output>;
}
const path = () => screen.getByLabelText('path').textContent;

async function open(route: string, seed?: (repos: Repos) => Promise<unknown>) {
  return renderWithApp(
    async ({ repos }) => {
      await seed?.(repos);
      return (
        <>
          <Routes>
            <Route path="/day/:date?" element={<DayRoute />} />
          </Routes>
          <Where />
        </>
      );
    },
    { route },
  );
}

const start = '2026-01-01';
const habitNames = () =>
  within(screen.getByRole('list', { name: 'Habits' }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('.habit-label')?.textContent);

describe('Daily view: routing and navigation (tasks 5.1, DAY-3)', () => {
  it('/day and invalid dates go to the logical today', async () => {
    await open('/day');
    await waitFor(() => expect(path()).toBe(`/day/${logicalToday(4)}`));
    expect(await screen.findByText('Today', { selector: '.day-title span' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Today' })).toBeDisabled();
  });

  it('rejects impossible dates', async () => {
    await open('/day/2026-02-30');
    await waitFor(() => expect(path()).toBe(`/day/${logicalToday(4)}`));
  });

  it('shows the date and moves with the arrows, the picker and Today', async () => {
    const app = await open(`/day/${THU}`);
    expect(await screen.findByRole('heading', { name: 'Thursday, August 13, 2026' })).toBeInTheDocument();
    await app.user.click(screen.getByRole('link', { name: 'Next day' }));
    expect(path()).toBe('/day/2026-08-14');
    await app.user.click(screen.getByRole('link', { name: 'Previous day' }));
    await app.user.click(screen.getByRole('link', { name: 'Previous day' }));
    expect(path()).toBe('/day/2026-08-12');
    fireEvent.change(screen.getByLabelText('Go to date'), { target: { value: '2026-12-25' } });
    expect(path()).toBe('/day/2026-12-25');
    await app.user.click(screen.getByRole('button', { name: 'Today' }));
    expect(path()).toBe(`/day/${logicalToday(4)}`);
  });

  it('keyboard: ←/→ change the day and t jumps to today, but not while typing', async () => {
    const app = await open(`/day/${THU}`, (repos) =>
      repos.habits.create({ name: 'Sleep', type: 'number', startDate: start }),
    );
    await screen.findByRole('textbox', { name: 'Sleep, August 13' });
    await app.user.keyboard('{ArrowRight}');
    expect(path()).toBe('/day/2026-08-14');
    await app.user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(path()).toBe('/day/2026-08-12');

    const input = await screen.findByRole('textbox', { name: 'Sleep, August 12' });
    await app.user.click(input);
    await app.user.keyboard('{ArrowLeft}t');
    expect(path()).toBe('/day/2026-08-12');
    await app.user.click(document.body);
    await app.user.keyboard('t');
    expect(path()).toBe(`/day/${logicalToday(4)}`);
  });

  it('arrow keys inside a rating change the rating, not the day', async () => {
    const app = await open(`/day/${THU}`, (repos) =>
      repos.habits.create({ name: 'Mood', type: 'rating', startDate: start }),
    );
    const group = await screen.findByRole('radiogroup', { name: 'Mood, August 13' });
    await waitFor(() => expect(within(group).getByRole('radio', { name: '1' })).toBeEnabled());
    await app.user.click(within(group).getByRole('radio', { name: '5' }));
    await app.user.keyboard('{ArrowRight}');
    expect(path()).toBe(`/day/${THU}`);
    await waitFor(() => expect(within(group).getByRole('radio', { name: '6' })).toBeChecked());
  });
});

describe('Daily view: habits (tasks 5.3, 5.4, DAY-1, DAY-5, HAB-5)', () => {
  it('a future day is read-only, with a note saying why (ENT-2)', async () => {
    const tomorrow = addDays(logicalToday(4), 1);
    await open(`/day/${tomorrow}`, (repos) =>
      repos.habits.create({ name: 'Exercise', type: 'boolean', startDate: start }),
    );
    const box = await screen.findByRole('checkbox', { name: /^Exercise, / });
    expect(screen.getByRole('note')).toHaveTextContent('hasn’t happened yet');
    expect(box).toBeDisabled();
    expect(screen.getByRole('button', { name: /note and options/ })).toBeDisabled();
  });

  it('today is not read-only', async () => {
    await open(`/day/${logicalToday(4)}`, (repos) =>
      repos.habits.create({ name: 'Exercise', type: 'boolean', startDate: start }),
    );
    const box = await screen.findByRole('checkbox', { name: /^Exercise, / });
    await waitFor(() => expect(box).toBeEnabled());
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('lists the habits active that day in user order, all types in one section', async () => {
    await open(`/day/${THU}`, async (repos) => {
      await repos.habits.create({ name: 'Exercise', type: 'boolean', startDate: start });
      await repos.habits.create({ name: 'Reading', type: 'duration', startDate: start });
      await repos.habits.create({ name: 'Future', type: 'boolean', startDate: '2026-09-01' });
      const old = await repos.habits.create({ name: 'Old', type: 'boolean', startDate: start });
      await repos.habits.archive(old.id, true);
      await repos.habits.create({ name: 'Mood', type: 'rating', startDate: start });
    });
    await screen.findByRole('checkbox', { name: 'Exercise, August 13' });
    expect(habitNames()).toEqual(['Exercise', 'Reading', 'Mood']);
    expect(screen.getByRole('textbox', { name: 'Reading, August 13' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Mood, August 13' })).toBeInTheDocument();
  });

  it('an archived habit still shows on a past day it was logged', async () => {
    await open(`/day/${THU}`, async (repos) => {
      const old = await repos.habits.create({ name: 'Old', type: 'boolean', startDate: start });
      await repos.entries.set(old.id, THU, 1);
      await repos.habits.archive(old.id, true);
    });
    expect(await screen.findByRole('checkbox', { name: 'Old, August 13' })).toBeChecked();
  });

  it('off days of weekday habits say "Not scheduled" but can still be logged', async () => {
    const app = await open(`/day/${THU}`, (repos) =>
      repos.habits.create({
        name: 'Gym',
        type: 'boolean',
        startDate: start,
        frequency: { type: 'weekdays', days: ['mon', 'wed', 'fri'] },
      }),
    );
    const box = await screen.findByRole('checkbox', { name: 'Gym, August 13' });
    expect(screen.getByText('Not scheduled')).toBeInTheDocument();
    await waitFor(() => expect(box).toBeEnabled());
    await app.user.click(box);
    await waitFor(async () =>
      expect((await app.repos.entries.forRange({ from: THU, to: THU }))[0]?.value).toBe(1),
    );
  });

  it('rest days say so, and doing the habit anyway is saved but flagged (HAB-5)', async () => {
    const app = await open(`/day/${THU}`, (repos) =>
      repos.habits.create({
        name: 'Gym',
        type: 'boolean',
        startDate: start,
        frequency: { type: 'weekdays', days: ['mon', 'wed', 'fri'], restOnOtherDays: true },
      }),
    );
    const box = await screen.findByRole('checkbox', { name: 'Gym, August 13' });
    expect(screen.getByText('Rest day')).toBeInTheDocument();
    expect(screen.queryByText('Not scheduled')).not.toBeInTheDocument();
    await waitFor(() => expect(box).toBeEnabled());
    await app.user.click(box);
    expect(await screen.findByText('⚠ Done on a rest day')).toBeInTheDocument();
    await waitFor(async () =>
      expect((await app.repos.entries.forRange({ from: THU, to: THU }))[0]?.value).toBe(1),
    );
  });

  it('target feedback updates as soon as a value is logged', async () => {
    const app = await open(`/day/${THU}`, async (repos) => {
      await repos.habits.create({
        name: 'Reading',
        type: 'duration',
        startDate: start,
        target: { value: 30, op: 'at_least', period: 'day' },
      });
      const ex = await repos.habits.create({
        name: 'Exercise',
        type: 'boolean',
        startDate: start,
        target: { value: 4, op: 'at_least', period: 'week' },
      });
      await repos.entries.set(ex.id, '2026-08-10', 1);
      await repos.entries.set(ex.id, '2026-08-11', 1);
      await repos.entries.set(ex.id, '2026-08-17', 1); // next week: not counted
    });
    expect(await screen.findByText('Target ≥ 30m')).toBeInTheDocument();
    expect(screen.getByText('2 / 4 this week')).toBeInTheDocument();

    const reading = screen.getByRole('textbox', { name: 'Reading, August 13' });
    await waitFor(() => expect(reading).toBeEnabled());
    await app.user.type(reading, '45{Enter}');
    expect(await screen.findByText('Target met (≥ 30m)')).toHaveClass('target-met');
    await app.user.click(screen.getByRole('checkbox', { name: 'Exercise, August 13' }));
    expect(await screen.findByText('3 / 4 this week')).toBeInTheDocument();
  });

  it('times-per-week habits show this week’s dots', async () => {
    await open(`/day/${THU}`, async (repos) => {
      const gym = await repos.habits.create({
        name: 'Gym',
        type: 'boolean',
        startDate: start,
        frequency: { type: 'times_per_week', count: 3 },
      });
      await repos.entries.set(gym.id, '2026-08-10', 1);
    });
    expect(await screen.findByLabelText('1 of 3 this week')).toHaveTextContent('●○○ 1/3 this week');
  });

  it('empty day offers to add a habit; journal entries for the date are listed', async () => {
    await open(`/day/${THU}`, async (repos) => {
      await repos.journal.create({ entryDate: THU, title: 'Long walk' });
      await repos.journal.create({ entryDate: '2026-08-14', title: 'Other day' });
    });
    expect(await screen.findByRole('link', { name: 'Add a habit' })).toBeInTheDocument();
    const journal = await screen.findByRole('list', { name: 'Journal entries' });
    expect(
      within(journal)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Long walk']);
  });
});
