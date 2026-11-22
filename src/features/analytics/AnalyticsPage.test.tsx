// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { Route, Routes, useLocation } from 'react-router-dom';
import { AnalyticsPage } from './AnalyticsPage';
import { renderWithApp } from '../../../tests/render';
import type { setup } from '../../../tests/helpers';
import { DEFAULT_CATEGORY_IDS } from '@/domain/ids';
import { HabitRoutes } from '@/features/habits/HabitPages';

vi.mock('@/app/features', () => ({ FEATURE_V1_1: true, SHOW_DEBUG: false }));

type Repos = Awaited<ReturnType<typeof setup>>['repos'];

function Where() {
  const l = useLocation();
  return <output aria-label="url">{l.pathname + l.search}</output>;
}

async function open(route: string, seed?: (repos: Repos) => Promise<unknown>) {
  return renderWithApp(
    async ({ repos }) => {
      await repos.settings.set('date_format', 'yyyy-MM-dd');
      await seed?.(repos);
      return (
        <main>
          <Routes>
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/habits/*" element={<HabitRoutes />} />
          </Routes>
          <Where />
        </main>
      );
    },
    { route },
  );
}

/** August 2026 against July 2026, both in the past. */
const AUGUST = '/analytics?period=month&from=2026-08-01';

async function seedHabits(repos: Repos) {
  const run = await repos.habits.create({
    name: 'Run',
    type: 'boolean',
    startDate: '2026-01-01',
    categoryId: DEFAULT_CATEGORY_IDS.health,
  });
  const read = await repos.habits.create({ name: 'Reading', type: 'duration', startDate: '2026-01-01' });
  await repos.habits.create({ name: 'Later', type: 'boolean', startDate: '2026-10-01' });
  for (const d of ['2026-08-01', '2026-08-02', '2026-08-14']) await repos.entries.set(run.id, d, 1);
  await repos.entries.set(run.id, '2026-07-10', 1);
  await repos.entries.set(read.id, '2026-08-14', 45);
  await repos.entries.set(read.id, '2026-08-15', 75);
  await repos.entries.set(read.id, '2026-07-01', 30);
  return { run, read };
}

const card = (name: string) => screen.getByRole('article', { name });
const headers = (article: HTMLElement) =>
  within(within(article).getByRole('table', { name: /stats$/ }))
    .getAllByRole('columnheader')
    .map((h) => h.textContent);
const cell = (article: HTMLElement, stat: string) =>
  within(within(article).getByRole('rowheader', { name: stat }).closest('tr')!)
    .getAllByRole('cell')
    .map((c) => c.textContent);

describe('Analytics (tasks 13.1–13.3, ANL-1…3)', () => {
  it('shows each habit active in the period with stats next to the previous period', async () => {
    await open(AUGUST, seedHabits);
    await screen.findByRole('article', { name: 'Run' });
    expect(screen.queryByRole('article', { name: 'Later' })).toBeNull();
    const run = card('Run');
    expect(headers(run)).toEqual(['Stat', 'August 2026', 'July 2026']);
    expect(cell(run, 'Done')).toEqual(['3 of 31', '1 of 31']);
    expect(cell(run, 'Longest streak')).toEqual(['2 days', '–']); // streaks aren't compared
    expect(cell(card('Reading'), 'Total')).toEqual(['2h', '30m']);
    expect(cell(card('Reading'), 'Average per logged day')).toEqual(['1h', '30m']);
  });

  it('charts by day with a table view and keyboard readout', async () => {
    const app = await open(AUGUST, seedHabits);
    const reading = await screen.findByRole('article', { name: 'Reading' });
    const chart = within(reading).getByRole('group', {
      name: /^Reading, August 2026, by day\. 2 of 31 days logged/,
    });
    await app.user.click(within(reading).getByText('Show as table'));
    const rows = within(within(reading).getByRole('table', { name: 'Reading, August 2026' })).getAllByRole(
      'row',
    );
    expect(rows).toHaveLength(32);
    expect([...rows[14]!.querySelectorAll('th, td')].map((c) => c.textContent)).toEqual(['08-14', '45m']);

    chart.focus();
    await app.user.keyboard('{Home}');
    expect(within(reading).getByText('08-01: nothing logged')).toBeInTheDocument();
    for (let i = 0; i < 13; i++) await app.user.keyboard('{ArrowRight}');
    expect(within(reading).getByText('08-14: 45m')).toBeInTheDocument();
    fireEvent.blur(chart);
    expect(within(reading).queryByText('08-14: 45m')).toBeNull();
  });

  it('switches periods: year (charted by week), previous, custom — kept in the URL', async () => {
    const app = await open(AUGUST, seedHabits);
    await screen.findByRole('article', { name: 'Run' });
    await app.user.click(screen.getByRole('radio', { name: 'Year' }));
    expect(screen.getByLabelText('url').textContent).toBe('/analytics?period=year&from=2026-01-01');
    expect(headers(card('Run'))).toEqual(['Stat', '2026', '2025']);
    expect(within(card('Run')).getByRole('group', { name: /, by week\./ })).toBeInTheDocument();
    expect(cell(card('Run'), 'Done')[0]).toMatch(/^4 of /);

    await app.user.click(screen.getByRole('button', { name: 'Previous period' }));
    expect(screen.getByLabelText('url').textContent).toBe('/analytics?period=year&from=2025-01-01');
    await waitFor(() =>
      expect(screen.getByText('No habits were active in this period.')).toBeInTheDocument(),
    );

    await app.user.click(screen.getByRole('radio', { name: 'Custom' }));
    const from = screen.getByLabelText('From');
    fireEvent.change(from, { target: { value: '2026-08-10' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-16' } });
    expect(screen.getByLabelText('url').textContent).toBe(
      '/analytics?period=custom&from=2026-08-10&to=2026-08-16',
    );
    const run = await screen.findByRole('article', { name: 'Run' });
    expect(headers(run)).toEqual(['Stat', '08-10 – 2026-08-16', '08-03 – 2026-08-09']);
    expect(cell(run, 'Done')).toEqual(['1 of 7', '0 of 7']);
  });

  it('summarises goals with status and category filters (tasks 13.5, ANL-4)', async () => {
    const app = await open(AUGUST, async (repos) => {
      await repos.goals.create({
        title: 'Learn French',
        categoryId: DEFAULT_CATEGORY_IDS.learning,
        targetDate: '2026-12-31',
      });
      await repos.goals.create({
        title: 'Garden',
        status: 'paused',
        progressMode: 'manual',
        progressManual: 40,
      });
      await repos.goals.create({
        title: 'Run a 10k',
        status: 'completed',
        categoryId: DEFAULT_CATEGORY_IDS.health,
      });
    });
    const table = await screen.findByRole('table', { name: 'Goals with status, progress and target date' });
    const titles = () =>
      within(table)
        .queryAllByRole('rowheader')
        .map((r) => r.textContent);
    expect(titles()).toEqual(['Learn French', 'Garden']);
    const french = within(table).getByRole('rowheader', { name: 'Learn French' }).closest('tr')!;
    expect(
      within(french)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['Active', 'No milestones yet', '2026-12-31', 'Learning']);

    await app.user.selectOptions(screen.getByLabelText('Filter goals by status'), 'all');
    expect(titles()).toEqual(['Learn French', 'Garden', 'Run a 10k']);
    await app.user.selectOptions(screen.getByLabelText('Filter by category'), DEFAULT_CATEGORY_IDS.health);
    expect(titles()).toEqual(['Run a 10k']);
    await app.user.selectOptions(screen.getByLabelText('Filter goals by status'), 'paused');
    expect(screen.getByText('No goals match these filters.')).toBeInTheDocument();
  });

  it('the habit page has the same stats and chart (tasks 13.4)', async () => {
    const app = await open('/habits', seedHabits);
    await app.user.click(await screen.findByRole('link', { name: /^Reading/ }));
    const section = await screen.findByRole('region', { name: 'Stats' });
    // It opens on this month; step back to August 2026 like the analytics page.
    const label = () => section.querySelector('.period-label')!.textContent;
    while (label() !== 'August 2026')
      await app.user.click(within(section).getByRole('button', { name: 'Previous period' }));
    expect(await within(section).findByText('2h')).toBeInTheDocument();
    expect(within(section).getByRole('group', { name: /^Reading, August 2026, by day/ })).toBeInTheDocument();
  });

  it('passes axe', async () => {
    await open(AUGUST, async (repos) => {
      await seedHabits(repos);
      await repos.goals.create({ title: 'Learn French' });
    });
    await screen.findByRole('article', { name: 'Run' });
    const result = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(
      result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
  });
});
