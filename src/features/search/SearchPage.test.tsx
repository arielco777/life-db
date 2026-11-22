// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { Route, Routes, useLocation } from 'react-router-dom';
import { SearchPage } from './SearchPage';
import { renderWithApp } from '../../../tests/render';
import type { setup } from '../../../tests/helpers';
import { App } from '@/app/App';
import { DEFAULT_CATEGORY_IDS } from '@/domain/ids';

vi.mock('@/app/startup', () => ({ afterInteractive: () => {}, markInteractive: () => {} }));

type Repos = Awaited<ReturnType<typeof setup>>['repos'];

function Where() {
  const l = useLocation();
  return <output aria-label="url">{l.pathname + l.search}</output>;
}
const url = () => screen.getByLabelText('url').textContent;

async function seed(repos: Repos) {
  await repos.settings.set('onboarding.completed', true);
  await repos.settings.set('date_format', 'yyyy-MM-dd');
  const travel = await repos.tags.getOrCreate('travel');
  await repos.tags.getOrCreate('french');
  const habit = await repos.habits.create({
    name: 'Study French',
    type: 'duration',
    startDate: '2026-01-01',
    categoryId: DEFAULT_CATEGORY_IDS.learning,
  });
  const goal = await repos.goals.create({ title: 'Learn a language' });
  await repos.goals.addMilestone(goal.id, { title: 'Pass the French A2 exam' });
  const entry = await repos.journal.create({
    entryDate: '2026-08-14',
    body: 'French class was hard today',
    tagIds: [travel.id],
  });
  const event = await repos.events.create({
    name: 'Trip to Lyon',
    description: 'Speaking French',
    startDate: '2026-07-01',
  });
  return { habit, goal, entry, event, travel };
}

async function openPage(route = '/search') {
  let s!: Awaited<ReturnType<typeof seed>>;
  const app = await renderWithApp(
    async ({ repos }) => {
      s = await seed(repos);
      return (
        <main>
          <Routes>
            <Route path="/search" element={<SearchPage />} />
            <Route path="*" element={<p>Record page</p>} />
          </Routes>
          <Where />
        </main>
      );
    },
    { route },
  );
  return { ...app, s };
}

const groupTitles = (name: string) =>
  within(screen.getByRole('list', { name }))
    .getAllByRole('link')
    .map((l) => l.querySelector('.habit-name')?.textContent ?? l.textContent);

describe('Search page (tasks 14.3, 14.4, SRCH-1…5)', () => {
  it('searches while typing and groups highlighted results by type', async () => {
    const app = await openPage();
    expect(screen.getByText(/^Type to search/)).toBeInTheDocument();
    await app.user.type(screen.getByRole('searchbox', { name: 'Search' }), 'fren');
    expect(url()).toBe('/search?q=fren');

    await screen.findByRole('list', { name: 'Journal' });
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Journal (1)',
      'Habits (1)',
      'Goals (1)',
      'Events (1)',
      'Tags (1)',
    ]);
    // Untitled: its date, in the user's date format once settings have loaded.
    await waitFor(() => expect(groupTitles('Journal')).toEqual(['2026-08-14']));
    expect(groupTitles('Goals')).toEqual(['Learn a language']);
    expect(
      within(screen.getByRole('list', { name: 'Goals' })).getByText('Milestone: Pass the French A2 exam'),
    ).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Events' })).getByText('2026-07-01')).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Tags' })).getByRole('link', { name: '#french' }),
    ).toHaveAttribute('href', expect.stringMatching(/^\/settings\/tags\//));
    const marks = [...document.querySelectorAll('mark')].map((m) => m.textContent);
    expect(marks.every((m) => /^fren/i.test(m!))).toBe(true);
    expect(screen.getByText('5 results')).toHaveAttribute('role', 'status');

    await app.user.click(within(screen.getByRole('list', { name: 'Habits' })).getByRole('link'));
    expect(url()).toBe(`/habits/${app.s.habit.id}`);
  });

  it('filters by type, category, tag and dates, kept in the URL', async () => {
    const app = await openPage('/search?q=french');
    await screen.findByRole('list', { name: 'Journal' });

    await app.user.selectOptions(screen.getByLabelText('Type'), 'journal_entry');
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Habits' })).toBeNull());
    expect(url()).toBe('/search?q=french&type=journal_entry');
    expect(screen.queryByRole('list', { name: 'Tags' })).toBeNull();

    await app.user.selectOptions(screen.getByLabelText('Type'), '');
    await app.user.selectOptions(screen.getByLabelText('Filter by category'), DEFAULT_CATEGORY_IDS.learning);
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Journal' })).toBeNull());
    expect(groupTitles('Habits')).toEqual(['Study French']);

    await app.user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(url()).toBe('/search?q=french');
    await app.user.selectOptions(screen.getByLabelText('Tag'), app.s.travel.id);
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Habits' })).toBeNull());
    expect(groupTitles('Journal')).toEqual(['2026-08-14']);

    await app.user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await app.user.type(screen.getByLabelText('To'), '2026-07-31');
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Journal' })).toBeNull());
    expect(groupTitles('Events')).toEqual(['Trip to Lyon']);
  });

  it('says when nothing matches', async () => {
    const app = await openPage();
    await app.user.type(screen.getByRole('searchbox', { name: 'Search' }), 'zebra');
    expect(await screen.findByText('Nothing matches “zebra”.')).toBeInTheDocument();
  });

  it('passes axe with results', async () => {
    await openPage('/search?q=fren');
    await screen.findByRole('list', { name: 'Journal' });
    const r = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual(
      [],
    );
  });
});

describe('Ctrl/Cmd+K palette (tasks 14.4, SRCH-1)', () => {
  async function openApp() {
    let s!: Awaited<ReturnType<typeof seed>>;
    const app = await renderWithApp(
      async ({ repos }) => {
        s = await seed(repos);
        return (
          <>
            <App />
            <Where />
          </>
        );
      },
      { route: '/journal' },
    );
    await screen.findByRole('heading', { name: 'Journal' });
    return { ...app, s };
  }

  it('opens from anywhere, picks a result with the keyboard and opens it', async () => {
    const app = await openApp();
    await app.user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Search' });
    const box = within(dialog).getByRole('combobox', { name: 'Search' });
    expect(box).toHaveFocus();
    await app.user.type(box, 'lyon');
    const option = await within(dialog).findByRole('option', { name: /Trip to Lyon/ });
    await app.user.keyboard('{ArrowDown}');
    expect(option).toHaveAttribute('aria-selected', 'true');
    expect(box).toHaveAttribute('aria-activedescendant', option.id);
    await app.user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(url()).toBe(`/events/${app.s.event.id}`);
  });

  it('Enter with nothing highlighted opens the full search; Escape closes and restores focus', async () => {
    const app = await openApp();
    const newEntry = screen.getByRole('link', { name: /New entry/ });
    newEntry.focus();
    await app.user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Search' });
    await app.user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(newEntry).toHaveFocus();

    await app.user.keyboard('{Meta>}k{/Meta}');
    await app.user.type(await screen.findByRole('combobox', { name: 'Search' }), 'french class');
    await within(screen.getByRole('dialog')).findByRole('option');
    await app.user.keyboard('{Enter}');
    expect(url()).toBe('/search?q=french%20class');
    expect(await screen.findByRole('heading', { name: 'Search' })).toBeInTheDocument();
    void dialog;
  });

  it('passes axe while open', async () => {
    const app = await openApp();
    await app.user.keyboard('{Control>}k{/Control}');
    await app.user.type(await screen.findByRole('combobox', { name: 'Search' }), 'fren');
    await within(screen.getByRole('dialog')).findAllByRole('option');
    const r = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual(
      [],
    );
  });
});
