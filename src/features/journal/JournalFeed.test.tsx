// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { FEED_PAGE } from './hooks';
import { JournalRoutes } from './JournalPages';
import { renderWithApp } from '../../../tests/render';
import type { setup } from '../../../tests/helpers';
import { addDays } from '@/domain/services/dates';
import { DEFAULT_CATEGORY_IDS } from '@/domain/ids';

type Ctx = Awaited<ReturnType<typeof setup>>;

function Where() {
  const l = useLocation();
  return <output aria-label="path">{l.pathname + l.search}</output>;
}
const path = () => screen.getByLabelText('path').textContent ?? '';

async function open(seed: (ctx: Ctx) => Promise<unknown>, route = '/journal') {
  return renderWithApp(
    async (ctx) => {
      await seed(ctx);
      return (
        <>
          <Routes>
            <Route path="/journal/*" element={<JournalRoutes />} />
            <Route path="/day/:date" element={<p>Day page</p>} />
          </Routes>
          <Where />
        </>
      );
    },
    { route },
  );
}

const headlines = () =>
  screen
    .queryAllByRole('link')
    .filter((a) => a.getAttribute('href')?.match(/^\/journal\/[0-9a-f-]{36}$/))
    .map((a) => a.firstChild?.textContent);

describe('Journal feed (task 7.1, JRN-5)', () => {
  it('lists entries newest first, grouped by date, each date linking to its day', async () => {
    const app = await open(async ({ repos, clock }) => {
      await repos.journal.create({ entryDate: '2026-08-10', body: 'Older' });
      await repos.journal.create({ entryDate: '2026-08-12', body: 'First of the 12th' });
      clock.advance();
      await repos.journal.create({ entryDate: '2026-08-12', title: 'Second', body: 'with a snippet' });
    });
    const day = await screen.findByRole('region', { name: 'Wednesday, August 12, 2026' });
    expect(
      within(day)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Secondwith a snippet', 'First of the 12th']);
    expect(headlines()).toEqual(['Second', 'First of the 12th', 'Older']);
    await app.user.click(within(day).getByRole('link', { name: 'Wednesday, August 12, 2026' }));
    expect(path()).toBe('/day/2026-08-12');
  });

  it('loads more entries page by page (keyset pagination)', async () => {
    const app = await open(async ({ repos }) => {
      for (let i = 0; i < FEED_PAGE + 5; i++)
        await repos.journal.create({ entryDate: addDays('2026-01-01', i), body: `Entry ${i}` });
    });
    await screen.findByText(`Entry ${FEED_PAGE + 4}`);
    expect(headlines()).toHaveLength(FEED_PAGE);
    await app.user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(headlines()).toHaveLength(FEED_PAGE + 5));
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    expect(headlines().at(-1)).toBe('Entry 0');
  });

  it('filters by date range, category ("No category" too) and tag, kept in the URL', async () => {
    const app = await open(async ({ repos }) => {
      const travel = await repos.tags.getOrCreate('travel');
      await repos.journal.create({ entryDate: '2026-08-01', body: 'Plain' });
      await repos.journal.create({
        entryDate: '2026-08-05',
        body: 'Run',
        categoryId: DEFAULT_CATEGORY_IDS.health,
      });
      await repos.journal.create({ entryDate: '2026-08-09', body: 'Flight', tagIds: [travel.id] });
    });
    await screen.findByText('Plain');

    await app.user.selectOptions(screen.getByRole('combobox', { name: 'Filter by category' }), 'Health');
    await waitFor(() => expect(headlines()).toEqual(['Run']));
    await app.user.selectOptions(screen.getByRole('combobox', { name: 'Filter by category' }), 'No category');
    await waitFor(() => expect(headlines()).toEqual(['Flight', 'Plain']));
    expect(path()).toBe('/journal?category=none');

    await app.user.selectOptions(screen.getByRole('combobox', { name: 'Filter by tag' }), '#travel');
    await waitFor(() => expect(headlines()).toEqual(['Flight']));

    await app.user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-08-02' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-06' } });
    await waitFor(() => expect(headlines()).toEqual(['Run']));
    expect(path()).toBe('/journal?from=2026-08-02&to=2026-08-06');
  });

  it('a filter with no matches offers to clear; filters from the URL apply on load', async () => {
    const app = await open(async ({ repos }) => {
      await repos.journal.create({ entryDate: '2026-08-01', body: 'Plain' });
    }, '/journal?category=' + DEFAULT_CATEGORY_IDS.work);
    expect(await screen.findByText('No entries match these filters.')).toBeInTheDocument();
    await app.user.click(
      within(screen.getByText('No entries match these filters.').parentElement!).getByRole('button'),
    );
    expect(await screen.findByText('Plain')).toBeInTheDocument();
    expect(path()).toBe('/journal');
  });

  it('offers archived categories and tags only when an entry uses them (CAT-5)', async () => {
    await open(async ({ repos }) => {
      await repos.tags.getOrCreate('unused');
      const used = await repos.tags.getOrCreate('used');
      await repos.journal.create({
        entryDate: '2026-08-01',
        body: 'x',
        categoryId: DEFAULT_CATEGORY_IDS.leisure,
        tagIds: [used.id],
      });
      await repos.categories.archive(DEFAULT_CATEGORY_IDS.leisure, true);
      await repos.categories.archive(DEFAULT_CATEGORY_IDS.home, true);
    });
    await screen.findByText('x');
    const cat = screen.getByRole('combobox', { name: 'Filter by category' });
    await waitFor(() => expect(within(cat).getByRole('group', { name: 'Archived' })).toBeInTheDocument());
    const archived = within(within(cat).getByRole('group', { name: 'Archived' })).getAllByRole('option');
    expect(archived.map((o) => o.textContent)).toEqual(['Leisure']);
    expect(within(cat).queryByRole('option', { name: 'No category' })).not.toBeInTheDocument();
    const tag = screen.getByRole('combobox', { name: 'Filter by tag' });
    expect(
      within(tag)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['All tags', '#used']);
  });

  it('empty journal invites the first entry', async () => {
    await open(async () => {});
    expect(await screen.findByText('No journal entries yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Write the first one' })).toHaveAttribute('href', '/journal/new');
  });
});
