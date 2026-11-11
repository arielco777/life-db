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
const BUDGET = { month: 200, day: 150, save: 50 };
/**
 * Shared CI runners are slower and noisier than a desktop, and these tests run React's
 * development build; locally the budgets apply as written. Typical local times: month
 * ~170 ms, day ~35 ms, save ~20 ms.
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
    // Warm-up month switch (first render of lazy paths, JIT), then the measured one.
    await app.user.click(screen.getByRole('link', { name: 'Previous month' }));
    await screen.findByRole('heading', { name: 'July 2026' }, SLOW);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(31 + 2), SLOW);

    const ms = await timeUntil(
      () => app.user.click(screen.getByRole('link', { name: 'Previous month' })),
      () => {
        expect(screen.getByRole('heading', { name: 'June 2026' })).toBeInTheDocument();
        const rows = screen.getAllByRole('row');
        expect(rows).toHaveLength(30 + 2); // header + 30 days + summary
        expect(within(rows[1]!).getAllByRole('gridcell')).toHaveLength(30);
      },
    );
    console.info(`month switch: ${ms.toFixed(0)} ms`);
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
});
