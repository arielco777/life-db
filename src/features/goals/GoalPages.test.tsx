// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { GoalRoutes } from './GoalPages';
import { renderWithApp } from '../../../tests/render';
import type { setup } from '../../../tests/helpers';
import { DEFAULT_CATEGORY_IDS } from '@/domain/ids';

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
            <Route path="/goals/*" element={<GoalRoutes />} />
          </Routes>
          <Where />
        </>
      );
    },
    { route },
  );
}

const path = () => screen.getByLabelText('path').textContent;
const titles = (list: HTMLElement) =>
  within(list)
    .getAllByRole('listitem')
    .map((li) => within(li).getByRole('link').textContent);

describe('Goals list (tasks 11.3)', () => {
  it('shows an empty state that leads to the form', async () => {
    const app = await open('/goals');
    await app.user.click(await screen.findByRole('link', { name: 'Create your first goal' }));
    expect(path()).toBe('/goals/new');
  });

  it('groups goals by status with progress, finished ones folded, and filters by category', async () => {
    const app = await open('/goals', async (repos) => {
      const fr = await repos.goals.create({
        title: 'Learn French',
        categoryId: DEFAULT_CATEGORY_IDS.learning,
      });
      await repos.goals.addMilestone(fr.id, { title: 'A1' });
      const a2 = await repos.goals.addMilestone(fr.id, { title: 'A2' });
      await repos.goals.setMilestoneDone(a2.id, true);
      await repos.goals.create({
        title: 'Read 20 books',
        progressMode: 'numeric',
        progressCurrent: 7,
        progressTarget: 20,
        progressUnit: 'books',
      });
      await repos.goals.create({
        title: 'Garden',
        status: 'paused',
        progressMode: 'manual',
        progressManual: 40,
      });
      await repos.goals.create({ title: 'Run a 10k', status: 'completed' });
    });

    const active = await screen.findByRole('list', { name: 'Active goals' });
    expect(titles(active)).toEqual(['Learn French', 'Read 20 books']);
    expect(screen.getByRole('progressbar', { name: 'Learn French progress' })).toHaveAttribute(
      'aria-valuetext',
      '1/2',
    );
    expect(screen.getByRole('progressbar', { name: 'Read 20 books progress' })).toHaveAttribute(
      'aria-valuenow',
      '35',
    );
    expect(titles(screen.getByRole('list', { name: 'Paused goals' }))).toEqual(['Garden']);
    expect(screen.getByText('Completed (1)').closest('details')).not.toHaveAttribute('open');
    expect(screen.queryByRole('list', { name: 'Not started goals' })).toBeNull();

    await app.user.selectOptions(screen.getByLabelText('Filter by category'), DEFAULT_CATEGORY_IDS.learning);
    expect(titles(screen.getByRole('list', { name: 'Active goals' }))).toEqual(['Learn French']);
    expect(screen.queryByRole('list', { name: 'Paused goals' })).toBeNull();
  });
});

describe('Goal form (tasks 11.4)', () => {
  it('creates a numeric goal and opens it', async () => {
    const app = await open('/goals/new');
    await app.user.type(await screen.findByLabelText('Title'), 'Read 20 books');
    await app.user.click(screen.getByLabelText(/^Count/));
    await app.user.type(screen.getByLabelText('Target value'), '20');
    await app.user.type(screen.getByLabelText('Unit'), 'books');
    await app.user.selectOptions(screen.getByLabelText('Category'), DEFAULT_CATEGORY_IDS.learning);
    await app.user.click(screen.getByRole('button', { name: 'Create goal' }));

    await waitFor(() => expect(path()).toMatch(/^\/goals\/[\w-]+$/));
    expect(await screen.findByRole('heading', { name: 'Read 20 books' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Progress' })).toHaveAttribute(
      'aria-valuetext',
      '0 / 20 books',
    );
    const [goal] = await app.repos.goals.list();
    expect(goal).toMatchObject({
      progressMode: 'numeric',
      progressTarget: 20,
      categoryId: DEFAULT_CATEGORY_IDS.learning,
    });
  });

  it('flags a missing title and a numeric goal without a target', async () => {
    const app = await open('/goals/new');
    await app.user.click(await screen.findByLabelText(/^Count/));
    await app.user.click(screen.getByRole('button', { name: 'Create goal' }));
    expect(screen.getByText('Give the goal a title')).toBeInTheDocument();
    expect(screen.getByText('Enter the target to reach')).toBeInTheDocument();
    expect(await app.repos.goals.list()).toEqual([]);
  });

  it('sets a target date only when "On a date" is chosen, like a habit end date', async () => {
    const app = await open('/goals/new');
    await app.user.type(await screen.findByLabelText('Title'), 'G');
    expect(screen.getByRole('radio', { name: 'None' })).toBeChecked();
    expect(screen.queryByLabelText('Target date')).toBeNull();

    await app.user.click(screen.getByRole('radio', { name: 'On a date' }));
    await app.user.click(screen.getByRole('button', { name: 'Create goal' }));
    expect(screen.getByText('Pick a target date, or choose None')).toBeInTheDocument();
    // Focus moves to the field that needs fixing.
    await waitFor(() => expect(screen.getByLabelText('Target date')).toHaveFocus());

    await app.user.type(screen.getByLabelText(/^Start date/), '2026-09-10');
    await app.user.type(screen.getByLabelText('Target date'), '2026-09-01');
    await app.user.click(screen.getByRole('button', { name: 'Create goal' }));
    expect(screen.getByText('The target date is before the start date')).toBeInTheDocument();

    // Choosing None again drops the date instead of saving it.
    await app.user.click(screen.getByRole('radio', { name: 'None' }));
    await app.user.click(screen.getByRole('button', { name: 'Create goal' }));
    await waitFor(() => expect(path()).toMatch(/^\/goals\/[\w-]+$/));
    const [goal] = await app.repos.goals.list();
    expect(goal!.targetDate).toBeUndefined();
  });

  it('switching an existing target date to None clears it', async () => {
    let id = '';
    const app = await open('/goals', async (repos) => {
      id = (await repos.goals.create({ title: 'Garden', targetDate: '2026-10-01' })).id;
    });
    await app.user.click(await screen.findByRole('link', { name: 'Garden' }));
    await app.user.click(await screen.findByRole('link', { name: 'Edit' }));
    expect(await screen.findByLabelText('Target date')).toHaveValue('2026-10-01');
    await app.user.click(screen.getByRole('radio', { name: 'None' }));
    await app.user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(path()).toBe(`/goals/${id}`));
    expect((await app.repos.goals.get(id))!.targetDate).toBeUndefined();
  });

  it('edits a goal, clearing emptied fields', async () => {
    let id = '';
    const app = await open('/goals', async (repos) => {
      id = (await repos.goals.create({ title: 'Garden', description: 'Veg patch', progressManual: 30 })).id;
    });
    await app.user.click(await screen.findByRole('link', { name: 'Garden' }));
    await app.user.click(await screen.findByRole('link', { name: 'Edit' }));
    const title = await screen.findByLabelText('Title');
    await app.user.clear(title);
    await app.user.type(title, 'Grow vegetables');
    await app.user.clear(screen.getByLabelText(/^Description/));
    await app.user.click(screen.getByLabelText(/^Percentage/));
    await app.user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(path()).toBe(`/goals/${id}`));
    const saved = await app.repos.goals.get(id);
    expect(saved).toMatchObject({ title: 'Grow vegetables', progressMode: 'manual', progressManual: 30 });
    expect(saved!.description).toBeUndefined();
  });
});

describe('Goal page', () => {
  it('changes status and records the completion date (GOAL-2)', async () => {
    let id = '';
    const app = await open('/goals', async (repos) => {
      id = (await repos.goals.create({ title: 'Run a 10k' })).id;
    });
    await app.user.click(await screen.findByRole('link', { name: 'Run a 10k' }));
    await app.user.selectOptions(await screen.findByLabelText('Status'), 'completed');
    expect(await screen.findByText(/^Completed /)).toBeInTheDocument();
    expect((await app.repos.goals.get(id))!.completedAt).toBeDefined();
  });

  it('updates manual and numeric progress (GOAL-4)', async () => {
    let manual = '';
    let numeric = '';
    const app = await open('/goals', async (repos) => {
      manual = (await repos.goals.create({ title: 'Garden', progressMode: 'manual' })).id;
      numeric = (
        await repos.goals.create({
          title: 'Books',
          progressMode: 'numeric',
          progressCurrent: 7,
          progressTarget: 20,
        })
      ).id;
    });
    await app.user.click(await screen.findByRole('link', { name: 'Garden' }));
    const pct = await screen.findByLabelText('Progress, percent');
    await app.user.type(pct, '140');
    expect(pct).toHaveAttribute('aria-invalid', 'true');
    await app.user.clear(pct);
    await app.user.type(pct, '40{Enter}');
    await waitFor(() =>
      expect(screen.getByRole('progressbar', { name: 'Progress' })).toHaveAttribute('aria-valuetext', '40%'),
    );
    expect((await app.repos.goals.get(manual))!.progressManual).toBe(40);

    await app.user.click(screen.getByRole('link', { name: '← Goals' }));
    await app.user.click(await screen.findByRole('link', { name: 'Books' }));
    await app.user.click(await screen.findByRole('button', { name: 'Add 1' }));
    await waitFor(() =>
      expect(screen.getByRole('progressbar', { name: 'Progress' })).toHaveAttribute(
        'aria-valuetext',
        '8 / 20',
      ),
    );
    const current = screen.getByLabelText('Current value');
    await app.user.clear(current);
    await app.user.type(current, '12');
    await app.user.tab();
    await waitFor(async () => expect((await app.repos.goals.get(numeric))!.progressCurrent).toBe(12));
  });

  it('adds, ticks, edits and deletes milestones, moving the progress bar (tasks 11.5)', async () => {
    let id = '';
    const app = await open('/goals', async (repos) => {
      id = (await repos.goals.create({ title: 'Learn French' })).id;
    });
    await app.user.click(await screen.findByRole('link', { name: 'Learn French' }));
    expect(await screen.findByText('No milestones yet')).toBeInTheDocument();

    const box = screen.getByLabelText('New milestone');
    await app.user.type(box, 'Finish A1{Enter}');
    await screen.findByRole('checkbox', { name: 'Finish A1' });
    expect(box).toHaveValue('');
    await app.user.type(box, 'Finish A2{Enter}');
    await screen.findByRole('checkbox', { name: 'Finish A2' });

    await app.user.click(screen.getByRole('checkbox', { name: 'Finish A1' }));
    await waitFor(() =>
      expect(screen.getByRole('progressbar', { name: 'Progress' })).toHaveAttribute('aria-valuetext', '1/2'),
    );
    expect(screen.getByText(/^Done /)).toBeInTheDocument();

    await app.user.click(screen.getByRole('button', { name: 'Edit Finish A2' }));
    const edit = screen.getByLabelText('Milestone');
    await app.user.clear(edit);
    await app.user.type(edit, 'Pass A2{Enter}');
    await screen.findByRole('checkbox', { name: 'Pass A2' });

    await app.user.click(screen.getByRole('button', { name: 'Delete Finish A1' }));
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Finish A1' })).toBeNull());
    expect((await app.repos.goals.get(id))!.milestones.map((m) => m.title)).toEqual(['Pass A2']);
    expect(screen.getByRole('progressbar', { name: 'Progress' })).toHaveAttribute('aria-valuetext', '0/1');
  });

  it('deletes a goal after confirming', async () => {
    const app = await open('/goals', async (repos) => {
      await repos.goals.create({ title: 'Garden' });
    });
    await app.user.click(await screen.findByRole('link', { name: 'Garden' }));
    await app.user.click(await screen.findByRole('button', { name: 'Delete' }));
    await app.user.click(screen.getByRole('button', { name: 'Delete goal' }));
    await waitFor(() => expect(path()).toBe('/goals'));
    expect(await app.repos.goals.list()).toEqual([]);
  });

  it('shows a message for a missing goal', async () => {
    await open('/goals/nope');
    expect(await screen.findByText("This goal doesn't exist or was deleted.")).toBeInTheDocument();
  });
});
