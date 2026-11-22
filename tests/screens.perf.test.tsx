// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { seedLargeDataset } from './fixtures/seed';
import { renderWithApp } from './render';
import { App } from '@/app/App';

/**
 * NFR-1 budgets measured on the screens themselves (task 9.6): 5 years × 30 habits plus
 * 3,000 journal entries, real repositories over SQLite, React rendering into jsdom.
 * jsdom is slower than the app's webview at DOM work, so passing here leaves headroom;
 * what it doesn't include is Tauri's IPC hop per query (well under a millisecond each).
 * The data layer's own share is in data.perf.test.ts.
 */
const BUDGET = { month: 200, day: 150, save: 50, search: 300, analytics: 1000 };
/**
 * Shared CI runners are slower and noisier than a desktop, and these tests run React's
 * development build; locally the budgets apply as written. Typical local times: month
 * ~190 ms, day ~60 ms, save ~35 ms; goals ~40 ms, events ~85 ms, analytics ~135 ms (a year
 * ~185 ms), search ~185 ms after typing pauses.
 */
const SLACK = process.env.CI ? 2 : 1;
const SLOW = { timeout: 10_000 };

async function openSeeded(route: string) {
  return renderWithApp(
    async ({ repos, driver }) => {
      await seedLargeDataset(driver);
      await repos.settings.set('onboarding.completed', true);
      return <App />;
    },
    { route },
  );
}

/** Milliseconds from `action` until `done` passes. */
async function timeUntil(action: () => unknown, done: () => void) {
  const t0 = performance.now();
  await action();
  await waitFor(done, { ...SLOW, interval: 5 });
  return performance.now() - t0;
}

describe('screen performance on a multi-year dataset (NFR-1, task 9.6)', () => {
  it(`switching months renders the full grid in < ${BUDGET.month} ms`, async () => {
    const app = await openSeeded('/month/2026-08');
    await screen.findByRole('heading', { name: 'August 2026' }, SLOW);
    await screen.findByRole('grid', {}, SLOW);
    // Warm-up month switch (first render of lazy paths, JIT), then three measured ones. The
    // median is compared, so one garbage-collection pause doesn't fail the run.
    await app.user.click(screen.getByRole('link', { name: 'Previous month' }));
    await screen.findByRole('heading', { name: 'July 2026' }, SLOW);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(31 + 2), SLOW);

    const times: number[] = [];
    for (const [name, days] of [
      ['June 2026', 30],
      ['May 2026', 31],
      ['April 2026', 30],
    ] as const) {
      times.push(
        await timeUntil(
          () => app.user.click(screen.getByRole('link', { name: 'Previous month' })),
          () => {
            expect(screen.getByRole('heading', { name })).toBeInTheDocument();
            const rows = screen.getAllByRole('row');
            expect(rows).toHaveLength(days + 2); // header + days + summary
            expect(within(rows[1]!).getAllByRole('gridcell')).toHaveLength(30);
          },
        ),
      );
    }
    const ms = [...times].sort((a, b) => a - b)[1]!;
    console.info(
      `month switch: ${ms.toFixed(0)} ms (median of ${times.map((t) => t.toFixed(0)).join(', ')})`,
    );
    expect(ms).toBeLessThan(BUDGET.month * SLACK);
  }, 60_000);

  it(`the daily view renders every habit in < ${BUDGET.day} ms, and a save shows in < ${BUDGET.save} ms`, async () => {
    const app = await openSeeded('/day/2026-08-13');
    await waitFor(() => expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0), SLOW);

    const day = await timeUntil(
      () => app.user.click(screen.getByRole('link', { name: 'Previous day' })),
      () => {
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/August 12/);
        expect(screen.getByRole('checkbox', { name: /^Habit 1,/ })).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: /^Habit 29,/ })).toBeInTheDocument();
      },
    );
    console.info(`day switch: ${day.toFixed(0)} ms`);
    expect(day).toBeLessThan(BUDGET.day * SLACK);

    const box = screen.getByRole('checkbox', { name: /^Habit 1,/ });
    const before = box.getAttribute('aria-checked');
    const save = await timeUntil(
      () => app.user.click(box),
      () =>
        expect(screen.getByRole('checkbox', { name: /^Habit 1,/ })).not.toHaveAttribute(
          'aria-checked',
          before!,
        ),
    );
    console.info(`save shown: ${save.toFixed(0)} ms`);
    expect(save).toBeLessThan(BUDGET.save * SLACK);
  }, 60_000);

  // V1.1 screens (task 15.1). NFR-1 names no budget for them; these hold them to the same
  // feel as the month view. Search's budget (300 ms) starts once typing pauses (150 ms).
  it('V1.1 screens: goals, events, analytics and search stay quick', async () => {
    const app = await openSeeded('/day/2026-08-13');
    await waitFor(() => expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0), SLOW);
    const nav = (name: string) => app.user.click(screen.getByRole('link', { name }));

    const goals = await timeUntil(
      () => nav('Goals'),
      () => expect(screen.getByRole('list', { name: 'Active goals' })).toBeInTheDocument(),
    );
    const events = await timeUntil(
      () => nav('Events'),
      () => expect(screen.getByRole('list', { name: 'Events in 2026' })).toBeInTheDocument(),
    );
    const analytics = await timeUntil(
      () => nav('Analytics'),
      () => expect(screen.getAllByRole('article')).toHaveLength(30),
    );
    const year = await timeUntil(
      () => app.user.click(screen.getByRole('radio', { name: 'Year' })),
      () => expect(screen.getAllByRole('group', { name: /, by week\./ })).toHaveLength(30),
    );

    await nav('Search');
    const box = await screen.findByRole('searchbox', { name: 'Search' }, SLOW);
    await app.user.type(box, 'walk');
    const typed = performance.now();
    await waitFor(() => expect(screen.getByRole('list', { name: 'Journal' })).toBeInTheDocument(), {
      ...SLOW,
      interval: 5,
    });
    const search = performance.now() - typed;

    console.info(
      `goals: ${goals.toFixed(0)} ms, events: ${events.toFixed(0)} ms, analytics month: ${analytics.toFixed(0)} ms, ` +
        `year: ${year.toFixed(0)} ms, search after typing: ${search.toFixed(0)} ms`,
    );
    expect(goals).toBeLessThan(BUDGET.month * SLACK);
    expect(events).toBeLessThan(BUDGET.month * SLACK);
    expect(analytics).toBeLessThan(BUDGET.analytics * SLACK);
    expect(year).toBeLessThan(BUDGET.analytics * SLACK);
    expect(search).toBeLessThan((BUDGET.search + 150) * SLACK);
  }, 120_000);
});
