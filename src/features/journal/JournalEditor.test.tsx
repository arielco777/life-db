// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { JournalRoutes } from './JournalPages';
import { renderWithApp } from '../../../tests/render';
import type { setup } from '../../../tests/helpers';
import { flushBeforeClose } from '@/app/closeGuard';
import { DEFAULT_CATEGORY_IDS } from '@/domain/ids';
import { DayRoute } from '@/features/day/DayPage';

type Ctx = Awaited<ReturnType<typeof setup>>;
const THU = '2026-08-13';
const SLOW = { timeout: 2500 }; // autosave waits 800 ms of quiet

function Where() {
  return <output aria-label="path">{useLocation().pathname}</output>;
}
const path = () => screen.getByLabelText('path').textContent ?? '';

async function open(route: string, seed?: (ctx: Ctx) => Promise<unknown>) {
  return renderWithApp(
    async (ctx) => {
      await seed?.(ctx);
      return (
        <>
          <Routes>
            <Route path="/journal/*" element={<JournalRoutes />} />
            <Route path="/day/:date?" element={<DayRoute />} />
          </Routes>
          <Where />
        </>
      );
    },
    { route },
  );
}

const all = async (app: Ctx) => (await app.repos.journal.list()).entries;

describe('Journal editor (tasks 7.2–7.5)', () => {
  it('a new entry is created by its first autosave, without losing the cursor', async () => {
    const app = await open(`/journal/new?date=${THU}`);
    const body = await screen.findByRole('textbox', { name: 'Entry' });
    expect(body).toHaveFocus();
    await app.user.type(body, 'Rainy walk');
    await waitFor(() => expect(path()).toMatch(/^\/journal\/[0-9a-f-]{36}$/), SLOW);
    expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saved');
    // Same editor instance: still focused, keeps typing into the same entry.
    expect(screen.getByRole('textbox', { name: 'Entry' })).toHaveFocus();
    await app.user.type(screen.getByRole('textbox', { name: 'Entry' }), ' by the river');
    await waitFor(async () => expect((await all(app))[0]?.body).toBe('Rainy walk by the river'), SLOW);
    expect(await all(app)).toHaveLength(1);
    expect((await all(app))[0]!.entryDate).toBe(THU);
    expect(screen.getByRole('heading', { name: 'Journal entry' })).toBeInTheDocument();
  });

  it('opening a new entry and leaving without typing leaves nothing behind', async () => {
    const app = await open(`/journal/new?date=${THU}`);
    await screen.findByRole('textbox', { name: 'Entry' });
    await app.user.click(screen.getByRole('link', { name: /Aug 13, 2026/ }));
    await waitFor(() => expect(path()).toBe(`/day/${THU}`));
    expect(await all(app)).toHaveLength(0);
  });

  it('saves on blur and when the editor goes away, before the debounce', async () => {
    const app = await open(`/journal/new?date=${THU}`);
    await app.user.type(await screen.findByRole('textbox', { name: 'Title' }), 'Trip');
    await app.user.tab(); // blur → save now
    await waitFor(async () => expect((await all(app))[0]?.title).toBe('Trip'));
    await app.user.type(screen.getByRole('textbox', { name: 'Entry' }), 'Packed');
    await app.user.click(screen.getByRole('link', { name: /Aug 13, 2026/ })); // unmount
    await waitFor(async () => expect((await all(app))[0]?.body).toBe('Packed'));
  });

  it('nothing typed is lost when the app closes (JRN-4)', async () => {
    const app = await open(`/journal/new?date=${THU}`);
    await app.user.type(await screen.findByRole('textbox', { name: 'Entry' }), 'Last thought');
    await flushBeforeClose(); // what the window's close handler awaits
    expect((await all(app))[0]?.body).toBe('Last thought');
  });

  it('date, category and tags save at once; moving the date moves the entry (JRN-3, JRN-6)', async () => {
    const app = await open('/journal', async ({ repos }) => {
      await repos.journal.create({ entryDate: THU, body: 'Notes' });
    });
    await app.user.click(await screen.findByRole('link', { name: 'Notes' }));
    fireEvent.change(await screen.findByLabelText('Date'), { target: { value: '2026-08-10' } });
    await waitFor(async () => expect((await all(app))[0]?.entryDate).toBe('2026-08-10'));
    expect(await app.repos.journal.forDate(THU)).toHaveLength(0);
    expect(screen.getByRole('link', { name: /Aug 10, 2026/ })).toHaveAttribute('href', '/day/2026-08-10');

    await app.user.selectOptions(screen.getByLabelText(/^Category/), 'Health');
    await waitFor(async () => expect((await all(app))[0]?.categoryId).toBe(DEFAULT_CATEGORY_IDS.health));
    await app.user.type(screen.getByRole('combobox', { name: 'Tags' }), 'travel{Enter}');
    await waitFor(async () => expect((await all(app))[0]?.tagIds).toHaveLength(1));
  });

  it('shows "edited" only when changed on a later day', async () => {
    const app = await open('/journal', async ({ repos, clock }) => {
      const a = await repos.journal.create({ entryDate: THU, body: 'Same day fix' });
      const b = await repos.journal.create({ entryDate: THU, body: 'Revisited' });
      clock.advance(60 * 60 * 1000); // an hour later, same day
      await repos.journal.update(a.id, { body: 'Same day fixed' });
      clock.advance(2 * 24 * 60 * 60 * 1000); // two days later
      await repos.journal.update(b.id, { body: 'Revisited later' });
    });
    await app.user.click(await screen.findByRole('link', { name: 'Same day fixed' }));
    expect(await screen.findByText('Written Aug 14, 2026')).toBeInTheDocument();
    expect(screen.queryByText(/edited/)).not.toBeInTheDocument();
    await app.user.click(screen.getByRole('link', { name: /Aug 13, 2026/ }));
    await app.user.click(await screen.findByRole('link', { name: 'Revisited later' }));
    expect(await screen.findByText('Written Aug 14, 2026 · edited Aug 16, 2026')).toBeInTheDocument();
  });

  it('previews Markdown without following links or loading images', async () => {
    const app = await open(`/journal/new?date=${THU}`);
    const body = await screen.findByRole('textbox', { name: 'Entry' });
    await app.user.click(body);
    await app.user.paste('**Big** day [site](https://example.com) ![cat](https://example.com/c.png)');
    await app.user.click(screen.getByRole('button', { name: 'Preview' }));
    const preview = await screen.findByRole('region', { name: 'Entry preview' });
    expect(within(preview).getByText('Big').tagName).toBe('STRONG');
    expect(within(preview).getByText('site')).toHaveAttribute('title', 'https://example.com');
    expect(preview.querySelector('a, img')).toBeNull();
    expect(preview).toHaveTextContent('[image: cat]');
    await app.user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByRole('textbox', { name: 'Entry' })).toHaveValue(
      '**Big** day [site](https://example.com) ![cat](https://example.com/c.png)',
    );
  });

  it('deletes after confirming (JRN-7)', async () => {
    const app = await open('/journal', async ({ repos }) => {
      await repos.journal.create({ entryDate: THU, body: 'To remove' });
    });
    await app.user.click(await screen.findByRole('link', { name: 'To remove' }));
    await app.user.click(await screen.findByRole('button', { name: 'Delete' }));
    await app.user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete entry' }),
    );
    await waitFor(() => expect(path()).toBe('/journal'));
    expect(await all(app)).toHaveLength(0);
    expect(await screen.findByText('No journal entries yet.')).toBeInTheDocument();
  });

  it('deleting an entry opened from the daily view lands on the journal list', async () => {
    const app = await open(`/day/${THU}`, async ({ repos }) => {
      await repos.journal.create({ entryDate: THU, body: 'Opened from the day' });
      await repos.journal.create({ entryDate: THU, body: 'Stays' });
    });
    await app.user.click(await screen.findByRole('link', { name: 'Opened from the day' }));
    await app.user.click(await screen.findByRole('button', { name: 'Delete' }));
    await app.user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete entry' }),
    );
    await waitFor(() => expect(path()).toBe('/journal'));
    expect(screen.queryByText(/doesn't exist or was deleted/)).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Stays' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Opened from the day' })).not.toBeInTheDocument();
  });

  it('an unknown entry says so', async () => {
    await open('/journal/0190a6e0-0000-7000-8000-00000000dead');
    expect(await screen.findByText(/doesn't exist or was deleted/)).toBeInTheDocument();
  });
});

describe('Journal in the daily view (task 7.4, JRN-2)', () => {
  it('lists every entry of the day with its headline, and opens the full editor for the date', async () => {
    const app = await open(`/day/${THU}`, async ({ repos }) => {
      await repos.journal.create({ entryDate: THU, title: 'Morning', body: 'Coffee on the porch' });
      await repos.journal.create({ entryDate: THU, body: '# Evening\nquiet' });
    });
    const list = await screen.findByRole('list', { name: 'Journal entries' });
    const links = within(list).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['MorningCoffee on the porch', 'Evening']);
    await app.user.click(screen.getByRole('link', { name: 'Full editor' }));
    expect(path()).toBe('/journal/new');
    await app.user.type(await screen.findByRole('textbox', { name: 'Entry' }), 'Third');
    await waitFor(async () => expect(await app.repos.journal.forDate(THU)).toHaveLength(3), SLOW);
  });
});
