// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { Route, Routes, useLocation } from 'react-router-dom';
import { EventRoutes } from './EventPages';
import { renderWithApp } from '../../../tests/render';
import type { setup } from '../../../tests/helpers';
import { DEFAULT_CATEGORY_IDS } from '@/domain/ids';
import { DayRoute } from '@/features/day/DayPage';
import { MonthRoute } from '@/features/month/MonthPage';
import { SettingsPage } from '@/features/settings/SettingsPage';

// The daily and monthly views show events only in V1.1 builds.
vi.mock('@/app/features', () => ({ FEATURE_V1_1: true, SHOW_DEBUG: false }));

type Repos = Awaited<ReturnType<typeof setup>>['repos'];

function Where() {
  return <output aria-label="path">{useLocation().pathname}</output>;
}
const path = () => screen.getByLabelText('path').textContent;

async function open(route: string, seed?: (repos: Repos) => Promise<unknown>) {
  return renderWithApp(
    async ({ repos }) => {
      await repos.settings.set('onboarding.completed', true);
      // Plain ISO dates in the UI, so assertions don't depend on the locale.
      await repos.settings.set('date_format', 'yyyy-MM-dd');
      await seed?.(repos);
      return (
        <main>
          <Routes>
            <Route path="/events/*" element={<EventRoutes />} />
            <Route path="/day/:date?" element={<DayRoute />} />
            <Route path="/month/:ym?" element={<MonthRoute />} />
            <Route path="/settings/*" element={<SettingsPage />} />
          </Routes>
          <Where />
        </main>
      );
    },
    { route },
  );
}

const lisbon = (repos: Repos) =>
  repos.events.create({
    name: 'Vacation in Lisbon',
    startDate: '2026-08-10',
    endDate: '2026-08-17',
    categoryId: DEFAULT_CATEGORY_IDS.leisure,
  });

const violations = async () =>
  (await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } })).violations.map(
    (v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );

describe('Events page (tasks 12.2, 12.3, EVT-1, EVT-3)', () => {
  it('quick-adds a one-day event and keeps the date for the next one', async () => {
    const app = await open('/events');
    expect(await screen.findByText(/^No events yet/)).toBeInTheDocument();
    const name = screen.getByLabelText('Name');
    const date = screen.getByLabelText('Date');
    await app.user.clear(date);
    await app.user.type(date, '2026-08-14');
    await app.user.type(name, 'Birthday');
    await app.user.click(screen.getByRole('button', { name: 'Add event' }));

    const list = await screen.findByRole('list', { name: 'Events in 2026' });
    expect(within(list).getByRole('link', { name: 'Birthday' })).toBeInTheDocument();
    expect(within(list).getByText('2026-08-14')).toBeInTheDocument();
    await waitFor(() => expect(name).toHaveValue(''));
    expect(date).toHaveValue('2026-08-14');
    const [e] = await app.repos.events.list();
    expect(e).toMatchObject({ name: 'Birthday', startDate: '2026-08-14' });
    expect(e!.endDate).toBeUndefined();
  });

  it('adds a range with category and tags, checking the last day', async () => {
    const app = await open('/events');
    await app.user.type(await screen.findByLabelText('Name'), 'Vacation in Lisbon');
    const date = screen.getByLabelText('Date');
    await app.user.clear(date);
    await app.user.type(date, '2026-08-10');
    await app.user.click(screen.getByRole('radio', { name: 'Until a date' }));
    await app.user.click(screen.getByRole('button', { name: 'Add event' }));
    expect(screen.getByText('Pick the last day, or choose One day')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Last day')).toHaveFocus());

    await app.user.type(screen.getByLabelText('Last day'), '2026-08-01');
    await app.user.click(screen.getByRole('button', { name: 'Add event' }));
    expect(screen.getByText('The last day is before the first')).toBeInTheDocument();

    const last = screen.getByLabelText('Last day');
    await app.user.clear(last);
    await app.user.type(last, '2026-08-17');
    await app.user.selectOptions(screen.getByLabelText('Category'), DEFAULT_CATEGORY_IDS.leisure);
    await app.user.type(screen.getByLabelText('Tags'), 'travel{Enter}');
    await app.user.click(screen.getByRole('button', { name: 'Add event' }));

    const list = await screen.findByRole('list', { name: 'Events in 2026' });
    expect(within(list).getByText(/2026-08-10 – 2026-08-17 · 8 days · Leisure/)).toBeInTheDocument();
    const [e] = await app.repos.events.list();
    expect(e).toMatchObject({ endDate: '2026-08-17', categoryId: DEFAULT_CATEGORY_IDS.leisure });
    expect(e!.tagIds).toHaveLength(1);
  });

  it('groups events by year, newest first', async () => {
    await open('/events', async (repos) => {
      await repos.events.create({ name: 'Moved', startDate: '2025-03-01' });
      await lisbon(repos);
      await repos.events.create({ name: 'New job', startDate: '2026-01-05' });
    });
    const years = await screen.findAllByRole('heading', { level: 2, name: /^\d{4}$/ });
    expect(years.map((h) => h.textContent)).toEqual(['2026', '2025']);
    expect(
      within(screen.getByRole('list', { name: 'Events in 2026' }))
        .getAllByRole('link', { name: /^(?!Open)/ })
        .map((l) => l.textContent),
    ).toEqual(['Vacation in Lisbon', 'New job']);
  });

  it('edits an event, turning a range into one day, and deletes it after confirming', async () => {
    let id = '';
    const app = await open('/events', async (repos) => {
      id = (await lisbon(repos)).id;
    });
    await app.user.click(await screen.findByRole('link', { name: 'Vacation in Lisbon' }));
    expect(await screen.findByLabelText('Last day')).toHaveValue('2026-08-17');
    const name = screen.getByLabelText('Name');
    await app.user.clear(name);
    await app.user.type(name, 'Lisbon');
    await app.user.click(screen.getByRole('radio', { name: 'One day' }));
    await app.user.type(screen.getByLabelText(/^Description/), 'Pastéis');
    await app.user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(path()).toBe('/events'));
    const saved = await app.repos.events.get(id);
    expect(saved).toMatchObject({ name: 'Lisbon', description: 'Pastéis' });
    expect(saved!.endDate).toBeUndefined();

    await app.user.click(await screen.findByRole('link', { name: 'Lisbon' }));
    await app.user.click(await screen.findByRole('button', { name: 'Delete' }));
    await app.user.click(screen.getByRole('button', { name: 'Delete event' }));
    await waitFor(() => expect(path()).toBe('/events'));
    expect(await app.repos.events.list()).toEqual([]);
  });

  it('shows a message for a missing event', async () => {
    await open('/events/nope');
    expect(await screen.findByText("This event doesn't exist or was deleted.")).toBeInTheDocument();
  });

  it('passes axe on the list and the edit page', async () => {
    const app = await open('/events', lisbon);
    await screen.findByRole('list', { name: 'Events in 2026' });
    expect(await violations()).toEqual([]);
    await app.user.click(screen.getByRole('link', { name: 'Vacation in Lisbon' }));
    await screen.findByRole('heading', { name: 'Edit event' });
    expect(await violations()).toEqual([]);
  });
});

describe('Events in the daily and monthly views (tasks 12.4, EVT-2, DAY-1, MON-6)', () => {
  it('shows a banner on every day the event covers', async () => {
    const app = await open('/day/2026-08-14', async (repos) => {
      await lisbon(repos);
      await repos.events.create({ name: 'Birthday', startDate: '2026-08-14' });
      await repos.events.create({ name: 'Elsewhere', startDate: '2026-08-20' });
    });
    const banner = await screen.findByRole('list', { name: 'Life events' });
    expect(
      within(banner)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['✦ Vacation in Lisbon (08-10 – 08-17 · day 5 of 8)', '✦ Birthday']);

    await app.user.click(screen.getByRole('link', { name: 'Next day' }));
    await app.user.click(screen.getByRole('link', { name: 'Next day' }));
    await app.user.click(screen.getByRole('link', { name: 'Next day' }));
    await app.user.click(screen.getByRole('link', { name: 'Next day' }));
    expect(path()).toBe('/day/2026-08-18');
    await screen.findByRole('heading', { name: 'Habits' });
    expect(screen.queryByRole('list', { name: 'Life events' })).toBeNull();
    expect(await violations()).toEqual([]);
  });

  it('marks event days next to the day number in the monthly grid', async () => {
    await open('/month/2026-08', async (repos) => {
      await repos.habits.create({ name: 'Run', type: 'boolean', startDate: '2026-01-01' });
      await repos.events.create({ name: 'Trip', startDate: '2026-07-30', endDate: '2026-08-02' });
      await repos.events.create({ name: 'Birthday', startDate: '2026-08-02' });
    });
    await screen.findByRole('grid');
    const dayLinks = screen.getAllByRole('link').filter((l) => l.getAttribute('href')?.startsWith('/day/'));
    const marked = dayLinks
      .filter((l) => l.querySelector('.event-marker'))
      .map((l) => l.getAttribute('href'));
    expect(marked).toEqual(['/day/2026-08-01', '/day/2026-08-02']);
    expect(dayLinks.find((l) => l.getAttribute('href') === '/day/2026-08-02')).toHaveAccessibleName(
      /, Trip, Birthday$/,
    );
  });
});

describe('Events in tag views (tasks 12.3, TAG-5)', () => {
  it('lists events carrying the tag, newest first', async () => {
    const app = await open('/settings/tags', async (repos) => {
      const tag = await repos.tags.getOrCreate('travel');
      await repos.events.create({ name: 'Rome', startDate: '2025-04-01', tagIds: [tag.id] });
      await repos.events.create({ name: 'Lisbon', startDate: '2026-08-10', tagIds: [tag.id] });
    });
    await app.user.click(await screen.findByRole('link', { name: /travel/ }));
    const list = await screen.findByRole('list', { name: 'Events' });
    expect(
      within(list)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Lisbon', 'Rome']);
  });
});
