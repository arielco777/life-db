import { seedLargeDataset } from './fixtures/seed';
import { setup } from './helpers';

/**
 * Data-layer share of the NFR-1 budgets on 5y × 30 habits + 3k journal entries.
 * UI rendering adds on top of this, so the data layer must stay well below the budgets.
 */
describe('performance on a multi-year dataset (NFR-1)', () => {
  it('month, day and journal queries stay fast', async () => {
    const { repos, driver } = await setup('2026-08-31T12:00:00');
    const seeded = await seedLargeDataset(driver);
    expect(seeded.entries).toBeGreaterThan(30_000);

    const time = async (fn: () => Promise<unknown>) => {
      const t0 = performance.now();
      await fn();
      return performance.now() - t0;
    };
    const aug = { from: '2026-08-01', to: '2026-08-31' };

    const month = await time(async () => {
      const habits = await repos.habits.activeOn(aug);
      await repos.entries.forRange(
        aug,
        habits.map((h) => h.id),
      );
    });
    const day = await time(async () => {
      await repos.habits.activeOn({ from: '2026-08-14', to: '2026-08-14' });
      await repos.entries.forRange({ from: '2026-08-14', to: '2026-08-14' });
      await repos.journal.forDate('2026-08-14');
    });
    const journal = await time(() => repos.journal.list({}, { limit: 50 }));

    expect(month).toBeLessThan(100);
    expect(day).toBeLessThan(75);
    expect(journal).toBeLessThan(75);
  }, 60_000);
});
