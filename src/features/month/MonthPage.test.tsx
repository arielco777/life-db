// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { MonthRoute } from './MonthPage';
import { renderWithApp } from '../../../tests/render';
import type { setup } from '../../../tests/helpers';
import { DEFAULT_CATEGORY_IDS } from '@/domain/ids';
import { logicalToday } from '@/domain/services/clock';

type Repos = Awaited<ReturnType<typeof setup>>['repos'];
const AUG = '2026-08';

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
            <Route path="/month/:ym?" element={<MonthRoute />} />
          </Routes>
          <Where />
        </>
      );
    },
    { route },
  );
}

/** Text of the cell for (day, column index) in the grid body. */
const cell = (day: number, col: number) => {
  const rows = within(screen.getByRole('grid')).getAllByRole('row');
  // rows[0] is the header; days follow in order.
  return within(rows[day]!).getAllByRole('gridcell')[col]!;
};

describe('Monthly view: routing and navigation (tasks 6.1, MON-2)', () => {
  it('/month and invalid months go to the current month', async () => {
    await open('/month/2026-13');
    await waitFor(() => expect(path()).toBe(`/month/${logicalToday(4).slice(0, 7)}`));
    expect(screen.getByRole('button', { name: 'This month' })).toBeDisabled();
  });

  it('moves with ‹ ›, the month and year pickers, and This month', async () => {
    const app = await open(`/month/${AUG}`);
    expect(await screen.findByRole('heading', { name: 'August 2026' })).toBeInTheDocument();
    await app.user.click(screen.getByRole('link', { name: 'Next month' }));
    expect(path()).toBe('/month/2026-09');
    await app.user.click(screen.getByRole('link', { name: 'Previous month' }));
    await app.user.click(screen.getByRole('link', { name: 'Previous month' }));
    expect(path()).toBe('/month/2026-07');
    await app.user.selectOptions(screen.getByRole('combobox', { name: 'Month' }), 'December');
    expect(path()).toBe('/month/2026-12');
    await app.user.selectOptions(screen.getByRole('combobox', { name: 'Year' }), '2025');
    expect(path()).toBe('/month/2025-12');
    await app.user.click(screen.getByRole('button', { name: 'This month' }));
    expect(path()).toBe(`/month/${logicalToday(4).slice(0, 7)}`);
  });

  it('prefetches the neighbouring months', async () => {
    const app = await open(`/month/${AUG}`);
    await screen.findByRole('heading', { name: 'August 2026' });
    await waitFor(() => {
      const keys = app.queryClient
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey.join('|'));
      expect(keys).toEqual(
        expect.arrayContaining(['entries|2026-07-01|2026-07-31|*', 'entries|2026-09-01|2026-09-30|*']),
      );
    });
  });
});

describe('Monthly grid (tasks 6.2, 6.3, 6.5, 6.6, MON-1, MON-4…6, MON-8)', () => {
  it('has a row per day and a column per habit with angled names (unit included)', async () => {
    await open(`/month/${AUG}`, async (repos) => {
      await repos.habits.create({ name: 'Exercise', type: 'boolean', startDate: '2026-01-01' });
      await repos.habits.create({ name: 'Coffee', type: 'number', unit: 'cups', startDate: '2026-01-01' });
    });
    const table = await screen.findByRole('grid', { name: 'Habits for August 2026' });
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual(['Day', 'Exercise', 'Coffee (cups)']);
    expect(headers[2]).toHaveAttribute('title', 'Coffee (cups)');
    const rowHeaders = within(table).getAllByRole('rowheader');
    expect(rowHeaders).toHaveLength(32); // 31 days + the summary row
    expect(within(rowHeaders[0]!).getByRole('link', { name: 'Saturday, August 1' })).toHaveAttribute(
      'href',
      '/day/2026-08-01',
    );
    expect(rowHeaders[0]!.closest('tr')).toHaveClass('weekend');
    expect(rowHeaders[2]!.closest('tr')).not.toHaveClass('weekend');
  });

  it('shows each type compactly, tinted with the category color; "not done" stays plain', async () => {
    await open(`/month/${AUG}`, async (repos) => {
      const s = '2026-01-01';
      const ex = await repos.habits.create({
        name: 'Exercise',
        type: 'boolean',
        startDate: s,
        categoryId: DEFAULT_CATEGORY_IDS.health,
      });
      const rd = await repos.habits.create({ name: 'Reading', type: 'duration', startDate: s });
      const sl = await repos.habits.create({ name: 'Sleep', type: 'number', unit: 'h', startDate: s });
      const md = await repos.habits.create({ name: 'Mood', type: 'rating', startDate: s });
      await repos.entries.set(ex.id, '2026-08-01', 1);
      await repos.entries.set(ex.id, '2026-08-02', 0);
      await repos.entries.set(rd.id, '2026-08-01', 90);
      await repos.entries.set(sl.id, '2026-08-01', 7.25);
      await repos.entries.set(md.id, '2026-08-01', 8);
    });
    await screen.findByRole('grid');
    expect(cell(1, 0)).toHaveTextContent('✓');
    expect(cell(1, 0)).toHaveClass('logged', 'done');
    expect(cell(1, 0).style.getPropertyValue('--cat')).toBe('#5f9e6e');
    expect(cell(1, 0)).toHaveAccessibleName('Exercise, Saturday, August 1: done');
    expect(cell(2, 0)).toHaveAccessibleName('Exercise, Sunday, August 2: not done');
    expect(cell(1, 1)).toHaveAccessibleName('Reading, Saturday, August 1: 1h 30m');
    expect(cell(2, 0)).toHaveTextContent('✗');
    expect(cell(2, 0)).not.toHaveClass('logged');
    expect(cell(1, 1)).toHaveTextContent('1h30');
    expect(cell(1, 1).style.getPropertyValue('--cat')).toBe('var(--accent)'); // no category
    expect(cell(1, 2)).toHaveTextContent('7.25');
    expect(cell(1, 3)).toHaveTextContent('8');
    expect(cell(3, 3)).toHaveTextContent('');
  });

  it('marks unscheduled and inactive days, and day targets met or missed', async () => {
    await open(`/month/${AUG}`, async (repos) => {
      await repos.habits.create({
        name: 'Gym',
        type: 'boolean',
        startDate: '2026-08-05',
        frequency: { type: 'weekdays', days: ['mon', 'wed', 'fri'] },
      });
      const coffee = await repos.habits.create({
        name: 'Coffee',
        type: 'number',
        startDate: '2026-01-01',
        target: { value: 2, op: 'at_most', period: 'day' },
      });
      await repos.entries.set(coffee.id, '2026-08-01', 1);
      await repos.entries.set(coffee.id, '2026-08-02', 4);
    });
    await screen.findByRole('grid');
    expect(cell(3, 0)).toHaveClass('inactive'); // Aug 3: before the start date
    expect(cell(6, 0)).toHaveClass('unscheduled'); // Thu Aug 6
    expect(cell(7, 0)).not.toHaveClass('unscheduled'); // Fri Aug 7
    expect(cell(1, 1)).toHaveClass('target-met');
    expect(cell(2, 1)).toHaveClass('target-missed');
  });

  it('includes habits archived or ended since, when they were active that month (MON-8)', async () => {
    await open(`/month/${AUG}`, async (repos) => {
      const old = await repos.habits.create({ name: 'Old', type: 'boolean', startDate: '2026-01-01' });
      await repos.entries.set(old.id, '2026-08-10', 1);
      await repos.habits.archive(old.id, true);
      await repos.habits.create({
        name: 'Ended',
        type: 'boolean',
        startDate: '2026-01-01',
        endDate: '2026-08-20',
      });
      await repos.habits.create({ name: 'Later', type: 'boolean', startDate: '2026-09-01' });
    });
    const table = await screen.findByRole('grid');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Day', 'Old', 'Ended']);
    expect(cell(21, 1)).toHaveClass('inactive'); // Aug 21: after "Ended" ended
  });

  it('ends each column with a month summary (MON-4)', async () => {
    await open(`/month/${AUG}`, async (repos) => {
      const ex = await repos.habits.create({ name: 'Exercise', type: 'boolean', startDate: '2026-01-01' });
      for (const d of ['01', '02', '03']) await repos.entries.set(ex.id, `2026-08-${d}`, 1);
      const cups = await repos.habits.create({
        name: 'Coffee',
        type: 'number',
        unit: 'cups',
        startDate: '2026-01-01',
      });
      await repos.entries.set(cups.id, '2026-08-01', 2);
      await repos.entries.set(cups.id, '2026-08-02', 3);
    });
    await screen.findByRole('grid');
    // August 2026 is in the past relative to the real clock, so the whole month counts.
    const summary = screen.getByRole('rowheader', { name: 'Month' }).closest('tr')!;
    const cells = [...summary.querySelectorAll('td')];
    expect(cells[0]).toHaveTextContent('3/31');
    expect(cells[0]).toHaveAccessibleName('Exercise: 3 of 31 scheduled days done (10%)');
    expect(cells[1]).toHaveTextContent('avg 2.5');
    expect(cells[1]).toHaveTextContent('5 cups');
  });

  it('shows an empty state with no habits', async () => {
    await open(`/month/${AUG}`);
    expect(await screen.findByText('No habits were active this month.')).toBeInTheDocument();
  });
});
