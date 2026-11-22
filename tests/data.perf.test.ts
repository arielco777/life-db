import { seedLargeDataset } from './fixtures/seed';
import { setup } from './helpers';
import { dayWindow } from '@/features/day/rowStatus';
import { buildHabitCsv, buildJournalFiles, buildJsonExport } from '@/features/transfer/build';

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
    // The daily view's queries (useDay): habits for the date, entries for its week + month
    // window (dayWindow), and its journal entries, issued in parallel.
    const day = await time(() =>
      Promise.all([
        repos.habits.activeOn({ from: '2026-08-14', to: '2026-08-14' }),
        repos.entries.forRange(dayWindow('2026-08-14', 'mon')),
        repos.journal.forDate('2026-08-14'),
      ]),
    );
    const journal = await time(() => repos.journal.list({}, { limit: 50 }));

    // Search (SRCH-5): a common word, a prefix while typing, and a filtered search.
    const word = await time(() => repos.search.search('walk'));
    const prefix = await time(() => repos.search.search('wa'));
    const filtered = await time(() =>
      repos.search.search('walk', { types: ['journal_entry'], from: '2026-01-01', to: '2026-08-31' }),
    );

    expect(month).toBeLessThan(100);
    expect(day).toBeLessThan(75);
    expect(journal).toBeLessThan(75);
    // NFR-1 allows 300 ms for results; the data layer keeps well under it.
    expect(word).toBeLessThan(150);
    expect(prefix).toBeLessThan(150);
    expect(filtered).toBeLessThan(150);
  }, 60_000);

  // NFR-12 (V1.5): each export of the whole dataset in under 5 s, building the file's text.
  // Writing it is Rust's job and adds little.
  it('exports the whole dataset within NFR-12', async () => {
    const { repos, driver } = await setup('2026-08-31T12:00:00');
    await seedLargeDataset(driver);
    const timed = async <T>(fn: () => Promise<T>) => {
      const t0 = performance.now();
      const out = await fn();
      return [performance.now() - t0, out] as const;
    };
    const [json, text] = await timed(() => buildJsonExport(repos, '1.5.0'));
    const [csv, sheet] = await timed(() =>
      buildHabitCsv(repos, { layout: 'long', includeArchived: true, dates: {} }),
    );
    const [wide] = await timed(() =>
      buildHabitCsv(repos, { layout: 'wide', includeArchived: true, dates: {} }),
    );
    const [md, files] = await timed(() => buildJournalFiles(repos, {}));
    console.info(
      `export: JSON ${json.toFixed(0)} ms (${(text.length / 1e6).toFixed(1)} MB), ` +
        `CSV ${csv.toFixed(0)} ms (${sheet.entries} entries), wide ${wide.toFixed(0)} ms, ` +
        `Markdown ${md.toFixed(0)} ms (${files.length} files)`,
    );
    expect(sheet.entries).toBeGreaterThan(30_000);
    expect(files).toHaveLength(3000);
    for (const ms of [json, csv, wide, md]) expect(ms).toBeLessThan(5000);
  }, 60_000);
});
