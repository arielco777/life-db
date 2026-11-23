import { setup } from './helpers';
import { DEFAULT_CATEGORY_IDS } from '@/domain/ids';
import { parseExport } from '@/domain/importFile';
import type { ExportFile } from '@/domain/transfer';

type Ctx = Awaited<ReturnType<typeof setup>>;

/** Every row of every table, for "nothing changed" checks. */
function snapshot(db: Ctx['db']) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      db
        .prepare(`SELECT * FROM "${name}"`)
        .all()
        .map((r) => JSON.stringify(r))
        .sort(),
    ]),
  );
}

/** Export → text → parse, as the app does. */
async function exportOf({ repos }: Ctx): Promise<ExportFile> {
  return parseExport(JSON.stringify(await repos.transfer.exportAll({ appVersion: '1.5.0' })));
}

const withoutDate = ({ exportedAt: _, ...rest }: ExportFile) => rest;

async function seed(ctx: Ctx) {
  const { repos, clock } = ctx;
  const travel = await repos.tags.getOrCreate('travel');
  const music = await repos.categories.create({ name: 'Music' });
  const run = await repos.habits.create({
    name: 'Run',
    type: 'duration',
    startDate: '2026-01-01',
    categoryId: DEFAULT_CATEGORY_IDS.health,
    tagIds: [travel.id],
  });
  const mood = await repos.habits.create({
    name: 'Mood',
    type: 'rating',
    ratingScale: { min: 1, max: 5 },
    startDate: '2026-01-01',
  });
  await repos.entries.set(run.id, '2026-08-10', 35, 'felt strong');
  await repos.entries.set(mood.id, '2026-08-10', 4);
  await repos.entries.set(run.id, '2026-08-11', 20);
  clock.advance();
  await repos.entries.clear(run.id, '2026-08-11');
  const goal = await repos.goals.create({ title: 'Run a 10k', habitIds: [run.id], months: ['2026-08'] });
  await repos.goals.addMilestone(goal.id, { title: 'First 5k' });
  const beach = await repos.journal.create({
    entryDate: '2026-08-13',
    title: 'Beach',
    body: 'Swam in the sea',
    tagIds: [travel.id],
    categoryId: music.id,
  });
  const gone = await repos.journal.create({ entryDate: '2026-08-14', body: 'Private, deleted' });
  await repos.journal.remove(gone.id);
  const trip = await repos.events.create({
    name: 'Trip to Lyon',
    startDate: '2026-07-01',
    endDate: '2026-07-05',
  });
  await repos.settings.set('week_start', 'sun');
  await repos.settings.set('date_format', 'yyyy-MM-dd');
  return { travel, music, run, mood, goal, beach, trip };
}

describe('import: replace (IMP-3, NFR-14)', () => {
  it('export → replace into a fresh app → export gives the same file', async () => {
    const a = await setup('2026-08-14T12:00:00');
    await seed(a);
    const file = await exportOf(a);

    const b = await setup('2026-09-01T12:00:00');
    const plan = await b.repos.transfer.plan(file, 'replace');
    expect(plan.counts.habits).toEqual({ add: 2, update: 0, remove: 0, unchanged: 0 });
    expect(plan.counts.categories.remove).toBe(8); // the fresh app's default categories
    await b.repos.transfer.apply(plan);

    expect(withoutDate(await exportOf(b))).toEqual(withoutDate(file));
    // Derived data follows: search finds imported records, settings apply.
    expect((await b.repos.search.search('beach')).hits.map((h) => h.title)).toEqual(['Beach']);
    expect(await b.repos.settings.get('week_start')).toBe('sun');
  });

  it('removes what the app had, but keeps this device’s own settings', async () => {
    const a = await setup('2026-08-14T12:00:00');
    await seed(a);
    const b = await setup('2026-09-01T12:00:00');
    await b.repos.habits.create({ name: 'Gym', type: 'boolean', startDate: '2026-01-01' });
    await b.repos.settings.set('backup.keep_count', 30);
    await b.repos.transfer.apply(await b.repos.transfer.plan(await exportOf(a), 'replace'));

    expect((await b.repos.habits.list({ includeArchived: true })).map((h) => h.name).sort()).toEqual([
      'Mood',
      'Run',
    ]);
    expect(b.db.prepare("SELECT count(*) AS n FROM habits WHERE name = 'Gym'").get()).toEqual({ n: 0 });
    expect(await b.repos.settings.get('backup.keep_count')).toBe(30);
  });

  it('a failure part-way changes nothing (IMP-5)', async () => {
    const a = await setup('2026-08-14T12:00:00');
    const { mood } = await seed(a);
    const file = await exportOf(a);
    // Valid to the file's schema, but the database refuses a rating habit without a scale.
    const broken = {
      ...file,
      habits: file.habits.map((h) => (h.id === mood.id ? { ...h, ratingMin: null } : h)),
    } as ExportFile;
    const b = await setup('2026-09-01T12:00:00');
    await b.repos.habits.create({ name: 'Gym', type: 'boolean', startDate: '2026-01-01' });
    const before = snapshot(b.db);
    await expect(b.repos.transfer.apply(await b.repos.transfer.plan(broken, 'replace'))).rejects.toThrow();
    expect(snapshot(b.db)).toEqual(before);
  });
});

describe('import: merge (IMP-4)', () => {
  /** Two apps with the same data, then edited apart. */
  async function diverged() {
    const a = await setup('2026-08-14T12:00:00');
    const s = await seed(a);
    const b = await setup('2026-08-14T12:00:00');
    await b.repos.transfer.apply(await b.repos.transfer.plan(await exportOf(a), 'replace'));
    a.clock.set('2026-08-20T12:00:00');
    b.clock.set('2026-08-20T12:00:00');
    return { a, b, ...s };
  }

  it('adds what’s new, keeps the newest edit of each record, and carries deletions over', async () => {
    const { a, b, run, beach, trip, goal } = await diverged();
    // A: renames Run, logs a new day, deletes the trip, deletes the goal (early).
    await a.repos.goals.remove(goal.id);
    a.clock.advance(60_000);
    await a.repos.habits.update(run.id, { name: 'Morning run' });
    await a.repos.entries.set(run.id, '2026-08-15', 40);
    await a.repos.events.remove(trip.id);
    // B: edits the journal entry and the goal (after A's deletion), logs its own day.
    b.clock.advance(120_000);
    await b.repos.journal.update(beach.id, { body: 'Swam twice' });
    await b.repos.goals.update(goal.id, { title: 'Run a half marathon' });
    await b.repos.entries.set(run.id, '2026-08-16', 50);

    const plan = await b.repos.transfer.plan(await exportOf(a), 'merge');
    expect(plan.counts.habits).toMatchObject({ add: 0, update: 1, remove: 0 });
    expect(plan.counts.habitEntries).toMatchObject({ add: 1, update: 0, remove: 0 });
    expect(plan.counts.lifeEvents).toMatchObject({ remove: 1 });
    expect(plan.counts.goals).toMatchObject({ remove: 0, unchanged: 1 }); // B's edit is newer
    expect(plan.counts.journalEntries).toMatchObject({ update: 0 });
    await b.repos.transfer.apply(plan);

    expect((await b.repos.habits.get(run.id))?.name).toBe('Morning run');
    const days = (await b.repos.entries.forRange({ from: '2026-08-01', to: '2026-08-31' }, [run.id])).map(
      (e) => e.date,
    );
    expect(days).toEqual(['2026-08-10', '2026-08-15', '2026-08-16']);
    expect(await b.repos.events.list()).toEqual([]);
    expect((await b.repos.goals.get(goal.id))?.title).toBe('Run a half marathon');
    expect((await b.repos.journal.get(beach.id))?.body).toBe('Swam twice');
    expect(await b.repos.settings.get('date_format')).toBe('yyyy-MM-dd'); // B's own settings stay
  });

  it('a tie keeps the app’s version', async () => {
    const { a, b, run } = await diverged();
    const file = await exportOf(a);
    const edited = {
      ...file,
      habits: file.habits.map((h) => (h.id === run.id ? { ...h, name: 'Changed, same time' } : h)),
    } as ExportFile;
    const plan = await b.repos.transfer.plan(edited, 'merge');
    expect(plan.counts.habits.update).toBe(0);
    await b.repos.transfer.apply(plan);
    expect((await b.repos.habits.get(run.id))?.name).toBe('Run');
  });

  it('merging the same file twice changes nothing the second time', async () => {
    const { a, b, run } = await diverged();
    await a.repos.habits.update(run.id, { name: 'Morning run' });
    const file = await exportOf(a);
    await b.repos.transfer.apply(await b.repos.transfer.plan(file, 'merge'));
    const after = snapshot(b.db);
    const again = await b.repos.transfer.plan(file, 'merge');
    for (const c of Object.values(again.counts)) expect(c).toMatchObject({ add: 0, update: 0, remove: 0 });
    await b.repos.transfer.apply(again);
    expect(snapshot(b.db)).toEqual(after);
  });

  it('combines same-name tags and categories made separately on each device', async () => {
    const a = await setup('2026-08-14T12:00:00');
    const aTravel = await a.repos.tags.getOrCreate('travel');
    const aMusic = await a.repos.categories.create({ name: 'Music' });
    const entry = await a.repos.journal.create({
      entryDate: '2026-08-13',
      body: 'Concert',
      tagIds: [aTravel.id],
      categoryId: aMusic.id,
    });
    const b = await setup('2026-08-15T12:00:00');
    const bTravel = await b.repos.tags.getOrCreate('Travel');
    const bMusic = await b.repos.categories.create({ name: 'music' });
    expect(bTravel.id).not.toBe(aTravel.id);

    const plan = await b.repos.transfer.plan(await exportOf(a), 'merge');
    expect(plan.combined).toEqual({ tags: 1, categories: 1 });
    await b.repos.transfer.apply(plan);

    expect((await b.repos.tags.list()).map((t) => t.id)).toEqual([bTravel.id]);
    expect((await b.repos.categories.list()).filter((c) => /music/i.test(c.name)).map((c) => c.id)).toEqual([
      bMusic.id,
    ]);
    const imported = await b.repos.journal.get(entry.id);
    expect(imported).toMatchObject({ tagIds: [bTravel.id], categoryId: bMusic.id });
    expect(await b.repos.tags.taggedWith(bTravel.id)).toEqual([
      { entityType: 'journal_entry', entityId: entry.id },
    ]);
  });
});

describe('import: checks (IMP-1, IMP-2)', () => {
  const valid = async () => {
    const a = await setup('2026-08-14T12:00:00');
    const s = await seed(a);
    return { a, file: await exportOf(a), ...s };
  };
  const text = (o: unknown) => JSON.stringify(o);

  it('rejects files that aren’t Life DB exports, or come from a newer version', async () => {
    const { file } = await valid();
    expect(() => parseExport('not json')).toThrow('isn’t a Life DB export');
    expect(() => parseExport(text({ app: 'other' }))).toThrow('isn’t a Life DB export');
    expect(() => parseExport(text({ ...file, format: 2 }))).toThrow('made by a newer version of Life DB');
  });

  it('names the record that is invalid', async () => {
    const { file } = await valid();
    const bad = { ...file, habits: file.habits.map((h, i) => (i === 0 ? { ...h, type: 'banana' } : h)) };
    expect(() => parseExport(text(bad))).toThrow(/habit #1 \(“(Run|Mood)”\), type is invalid/);
    const twoBad = {
      ...bad,
      lifeEvents: file.lifeEvents.map((e) => ({ ...e, startDate: 'soon' })),
    };
    expect(() => parseExport(text(twoBad))).toThrow(/and 1 more problem\)/);
  });

  it('rejects duplicated records, hand-edited IDs and impossible values', async () => {
    const { file, mood } = await valid();
    expect(() => parseExport(text({ ...file, goals: [...file.goals, ...file.goals] }))).toThrow(
      'appears twice',
    );
    const renamed = file.habitEntries.map((e, i) =>
      i === 0 ? { ...e, id: '0190a6e0-0000-7000-8000-00000000dead' } : e,
    );
    expect(() => parseExport(text({ ...file, habitEntries: renamed }))).toThrow(
      'has an ID that doesn’t match it',
    );
    const tooHigh = file.habitEntries.map((e) =>
      e.habitId === mood.id && 'value' in e ? { ...e, value: 9 } : e,
    );
    expect(() => parseExport(text({ ...file, habitEntries: tooHigh }))).toThrow(
      /Rating must be a whole number from 1 to 5/,
    );
  });

  it('rejects a record pointing to one that is nowhere; drops a deletion pointing nowhere', async () => {
    const { file, run } = await valid();
    const b = await setup('2026-09-01T12:00:00');
    const noHabits = {
      ...file,
      habits: [],
      goalHabits: [],
      entityTags: file.entityTags.filter((t) => t.entityType !== 'habit'),
    };
    await expect(b.repos.transfer.plan(noHabits, 'merge')).rejects.toThrow(
      'a habit entry refers to a habit that isn’t in the file or in Life DB',
    );

    const onlyDeleted = {
      ...noHabits,
      habitEntries: file.habitEntries.filter((e) => e.deletedAt && e.habitId === run.id),
    };
    expect(onlyDeleted.habitEntries).toHaveLength(1);
    const plan = await b.repos.transfer.plan(onlyDeleted, 'replace');
    expect(plan.droppedDeletions).toBe(1);
    expect(plan.file.habitEntries).toEqual([]);
  });

  it('planning reads only', async () => {
    const { file } = await valid();
    const b = await setup('2026-09-01T12:00:00');
    const before = snapshot(b.db);
    await b.repos.transfer.plan(file, 'replace');
    await b.repos.transfer.plan(file, 'merge');
    expect(snapshot(b.db)).toEqual(before);
  });
});
