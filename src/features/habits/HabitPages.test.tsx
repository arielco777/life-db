// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { HabitRoutes } from './HabitPages';
import { renderWithApp } from '../../../tests/render';
import type { setup } from '../../../tests/helpers';
import { DEFAULT_CATEGORY_IDS } from '@/domain/ids';
import { logicalToday } from '@/domain/services/clock';

type Repos = Awaited<ReturnType<typeof setup>>['repos'];

function Where() {
  return <output aria-label="path">{useLocation().pathname}</output>;
}

async function open(route: string, seed?: (repos: Repos) => Promise<unknown>) {
  return renderWithApp(
    async ({ repos }) => {
      await seed?.(repos);
      return (
        <>
          <Routes>
            <Route path="/habits/*" element={<HabitRoutes />} />
          </Routes>
          <Where />
        </>
      );
    },
    { route },
  );
}

const path = () => screen.getByLabelText('path').textContent;
const rowNames = (list: HTMLElement) =>
  within(list)
    .getAllByRole('listitem')
    .map((li) => within(li).getByRole('link').textContent);

describe('Habits list (tasks 4.1)', () => {
  it('shows an empty state that leads to the form', async () => {
    const app = await open('/habits');
    await app.user.click(await screen.findByRole('link', { name: 'Create your first habit' }));
    expect(path()).toBe('/habits/new');
  });

  it('lists active habits in order with a summary; archived ones in their own section', async () => {
    await open('/habits', async (repos) => {
      await repos.habits.create({
        name: 'Coffee',
        type: 'number',
        unit: 'cups',
        target: { value: 2, op: 'at_most', period: 'day' },
        categoryId: DEFAULT_CATEGORY_IDS.health,
      });
      await repos.habits.create({
        name: 'Gym',
        type: 'boolean',
        frequency: { type: 'times_per_week', count: 3 },
      });
      const old = await repos.habits.create({ name: 'Old', type: 'boolean' });
      await repos.habits.archive(old.id, true);
    });
    const list = await screen.findByRole('list', { name: 'Habits' });
    expect(rowNames(list)).toEqual(['Coffee', 'Gym']);
    expect(within(list).getByText(/Number · Daily · At most 2 cups per day · Health/)).toBeInTheDocument();
    expect(within(list).getByText('Checkbox · 3× a week')).toBeInTheDocument();
    expect(screen.getByText('Archived (1)')).toBeInTheDocument();
  });

  it('filters by category, offering archived categories only when used (CAT-5)', async () => {
    const app = await open('/habits', async (repos) => {
      await repos.habits.create({ name: 'Run', type: 'boolean', categoryId: DEFAULT_CATEGORY_IDS.health });
      await repos.habits.create({ name: 'Budget', type: 'boolean', categoryId: DEFAULT_CATEGORY_IDS.money });
      await repos.habits.create({ name: 'Loose', type: 'boolean' });
      await repos.categories.archive(DEFAULT_CATEGORY_IDS.money, true);
      await repos.categories.archive(DEFAULT_CATEGORY_IDS.work, true); // unused → not offered
    });
    const list = await screen.findByRole('list', { name: 'Habits' });
    const filter = screen.getByRole('combobox', { name: 'Filter by category' });
    await within(filter).findByRole('option', { name: 'Health' });
    const archivedGroup = within(filter).getByRole('group', { name: 'Archived' });
    expect(
      within(archivedGroup)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Money']);
    expect(within(filter).queryByRole('option', { name: 'Work' })).not.toBeInTheDocument();

    await app.user.selectOptions(filter, 'Money');
    expect(rowNames(list)).toEqual(['Budget']);
    expect(screen.getByText('Clear the filter to reorder.')).toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: /Reorder/ })).not.toBeInTheDocument();
    await app.user.selectOptions(filter, 'No category');
    expect(rowNames(list)).toEqual(['Loose']);
    await app.user.selectOptions(filter, 'Leisure');
    expect(screen.getByText('No habits in this category.')).toBeInTheDocument();
  });

  it('reorders with the keyboard drag handle (HAB-10)', async () => {
    const app = await open('/habits', async (repos) => {
      for (const name of ['A', 'B', 'C']) await repos.habits.create({ name, type: 'boolean' });
    });
    const list = await screen.findByRole('list', { name: 'Habits' });
    // jsdom has no layout: give each row a stacked box so the sortable keyboard sensor can move between them.
    const rows = within(list).getAllByRole('listitem');
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () =>
        ({
          top: i * 50,
          bottom: i * 50 + 40,
          left: 0,
          right: 300,
          width: 300,
          height: 40,
          x: 0,
          y: i * 50,
        }) as DOMRect;
    });
    const handle = within(list).getByRole('button', { name: 'Reorder A' });
    handle.focus();
    await app.user.keyboard(' ');
    await app.user.keyboard('{ArrowDown}');
    await app.user.keyboard(' ');
    await waitFor(async () =>
      expect((await app.repos.habits.list()).map((h) => h.name)).toEqual(['B', 'A', 'C']),
    );
    await waitFor(() => expect(rowNames(list)).toEqual(['B', 'A', 'C']));
  });
});

describe('Habit form (tasks 4.2)', () => {
  it('refuses to save without a name and focuses the field (HAB-1)', async () => {
    const app = await open('/habits/new');
    await app.user.click(await screen.findByRole('button', { name: 'Create habit' }));
    expect(screen.getByText('Give the habit a name')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveFocus());
    expect(await app.repos.habits.list()).toHaveLength(0);
  });

  it('creates a habit with every field and opens it', async () => {
    const app = await open('/habits/new');
    const { user } = app;
    await user.type(await screen.findByLabelText('Name'), 'Water');
    await user.click(screen.getByRole('radio', { name: /Number/ }));
    await user.type(screen.getByLabelText(/Unit/), 'L');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Schedule' }), 'On specific days');
    await user.click(screen.getByRole('button', { name: 'Fri' })); // default Mon/Wed/Fri → Mon/Wed
    await user.click(screen.getByLabelText('Set a target'));
    await user.type(screen.getByLabelText('Target value'), '2,5');
    await user.selectOptions(screen.getByLabelText(/^Category/), 'Health');
    await user.click(screen.getByRole('radio', { name: 'High' }));
    await user.type(screen.getByRole('combobox', { name: 'Tags' }), 'hydration{Enter}');
    await user.type(screen.getByLabelText(/Description/), 'Two bottles');
    await user.click(screen.getByRole('button', { name: 'Create habit' }));

    await waitFor(() => expect(path()).toMatch(/^\/habits\/[0-9a-f-]+$/));
    const [h] = await app.repos.habits.list();
    expect(h).toMatchObject({
      name: 'Water',
      type: 'number',
      unit: 'L',
      frequency: { type: 'weekdays', days: ['mon', 'wed'] },
      target: { value: 2.5, op: 'at_least', period: 'day' },
      categoryId: DEFAULT_CATEGORY_IDS.health,
      priority: 'high',
      description: 'Two bottles',
      startDate: logicalToday(4),
    });
    expect(h!.tagIds).toHaveLength(1);
    expect(await screen.findByRole('heading', { name: 'Water' })).toBeInTheDocument();
  });

  it('edits: type and scale are locked once entries exist; emptied fields are cleared (HAB-2, HAB-7)', async () => {
    let id = '';
    const app = await open('/habits/x', async (repos) => {
      const h = await repos.habits.create({
        name: 'Mood',
        type: 'rating',
        ratingScale: { min: 1, max: 5 },
        target: { value: 4, op: 'at_least', period: 'week' },
        description: 'how I feel',
      });
      id = h.id;
      await repos.entries.set(h.id, logicalToday(4), 4);
    });
    // Navigate to the real edit URL now that the ID is known.
    await app.user.click(await screen.findByRole('link', { name: '← Habits' }));
    await app.user.click(await screen.findByRole('link', { name: 'Mood' }));
    await app.user.click(await screen.findByRole('link', { name: 'Edit' }));
    expect(path()).toBe(`/habits/${id}/edit`);

    expect(await screen.findByText(/its type and scale can't change/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Checkbox/ })).toBeDisabled();
    expect(screen.getByLabelText('Highest rating')).toBeDisabled();
    await app.user.click(screen.getByLabelText('Set a target'));
    await app.user.clear(screen.getByLabelText(/Description/));
    await app.user.clear(screen.getByLabelText('Name'));
    await app.user.type(screen.getByLabelText('Name'), 'Mood today');
    await app.user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(path()).toBe(`/habits/${id}`));
    const h = await app.repos.habits.get(id);
    expect(h).toMatchObject({ name: 'Mood today', type: 'rating', ratingScale: { min: 1, max: 5 } });
    expect(h?.target).toBeUndefined();
    expect(h?.description).toBeUndefined();
  });
});

describe('Habit detail (tasks 4.3)', () => {
  async function detail() {
    let id = '';
    const app = await open('/habits', async (repos) => {
      // The UI's "today" is the real clock; the test DB clock is fixed, so set the start date explicitly.
      id = (await repos.habits.create({ name: 'Exercise', type: 'boolean', startDate: logicalToday(4) })).id;
    });
    await app.user.click(await screen.findByRole('link', { name: 'Exercise' }));
    await screen.findByRole('heading', { name: 'Exercise' });
    return { ...app, id };
  }

  it('logs values for recent days', async () => {
    const app = await detail();
    const week = screen.getByRole('list', { name: 'Last 7 days' });
    expect(within(week).getAllByRole('listitem')).toHaveLength(1); // the habit started today
    const box = within(week).getByRole('checkbox');
    await waitFor(() => expect(box).toBeEnabled());
    await app.user.click(box);
    await waitFor(async () => expect((await app.repos.entries.get(app.id, logicalToday(4)))?.value).toBe(1));
  });

  it('archives and unarchives (HAB-8)', async () => {
    const app = await detail();
    await app.user.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('Archived')).toBeInTheDocument();
    expect((await app.repos.habits.get(app.id))?.archivedAt).toBeDefined();
    await app.user.click(screen.getByRole('button', { name: 'Unarchive' }));
    await waitFor(() => expect(screen.queryByText('Archived')).not.toBeInTheDocument());
  });

  it('deletes after confirmation, with its entries (HAB-9)', async () => {
    const app = await detail();
    await app.repos.entries.set(app.id, logicalToday(4), 1);
    await app.user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete “Exercise”?' });
    await app.user.click(within(dialog).getByRole('button', { name: 'Delete habit' }));
    await waitFor(() => expect(path()).toBe('/habits'));
    expect(await app.repos.habits.get(app.id)).toBeNull();
    expect(await app.repos.entries.get(app.id, logicalToday(4))).toBeNull();
    expect(await screen.findByText(/No habits yet/)).toBeInTheDocument();
  });

  it('handles an unknown habit', async () => {
    await open('/habits/nope');
    expect(await screen.findByText(/doesn't exist/)).toBeInTheDocument();
  });
});
