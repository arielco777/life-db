import { createNodeDriver } from './nodeDriver';
import { setup } from './helpers';
import { createRepositories, migrate } from '@/data/sqlite';
import { isDomainError } from '@/domain/errors';
import { DEFAULT_CATEGORY_IDS, naturalId } from '@/domain/ids';

const isCode = (code: Parameters<typeof isDomainError>[1]) => (e: unknown) => isDomainError(e, code);

const searchRows = (db: ReturnType<typeof createNodeDriver>['db'], q: string) =>
  db.prepare('SELECT entity_type, entity_id FROM search_index WHERE search_index MATCH ?').all(q);

describe('goals', () => {
  it('creates with defaults and every field (GOAL-1, GOAL-2, GOAL-4)', async () => {
    const { repos } = await setup();
    const plain = await repos.goals.create({ title: '  Learn French  ' });
    expect(plain).toMatchObject({
      title: 'Learn French',
      status: 'active',
      priority: 'medium',
      progressMode: 'milestones',
      sortOrder: 1,
      milestones: [],
      habitIds: [],
      months: [],
      tagIds: [],
    });
    expect(plain.completedAt).toBeUndefined();

    const tag = await repos.tags.getOrCreate('books');
    const full = await repos.goals.create({
      title: 'Read 20 books',
      description: 'Fiction counts',
      categoryId: DEFAULT_CATEGORY_IDS.learning,
      priority: 'high',
      status: 'not_started',
      progressMode: 'numeric',
      progressCurrent: 7,
      progressTarget: 20,
      progressUnit: 'books',
      startDate: '2026-01-01',
      targetDate: '2026-12-31',
      tagIds: [tag.id],
      months: ['2026-09', '2026-08'],
    });
    expect(full).toMatchObject({
      sortOrder: 2,
      categoryId: DEFAULT_CATEGORY_IDS.learning,
      progressCurrent: 7,
      progressTarget: 20,
      progressUnit: 'books',
      tagIds: [tag.id],
      months: ['2026-08', '2026-09'],
    });
    expect(await repos.goals.get(full.id)).toEqual(full);
  });

  it('validates input', async () => {
    const { repos } = await setup();
    await expect(repos.goals.create({ title: ' ' })).rejects.toSatisfy(isCode('validation'));
    await expect(
      repos.goals.create({ title: 'X', startDate: '2026-08-10', targetDate: '2026-08-01' }),
    ).rejects.toSatisfy(isCode('validation'));
    await expect(repos.goals.create({ title: 'X', progressMode: 'numeric' })).rejects.toSatisfy(
      isCode('validation'),
    );
    await expect(repos.goals.create({ title: 'X', progressManual: 120 })).rejects.toSatisfy(
      isCode('validation'),
    );
    await expect(repos.goals.create({ title: 'X', months: ['2026-13'] })).rejects.toSatisfy(
      isCode('validation'),
    );
    await expect(repos.goals.create({ title: 'X', habitIds: ['nope'] })).rejects.toSatisfy(
      isCode('validation'),
    );
    await expect(repos.goals.update('missing', { title: 'Y' })).rejects.toSatisfy(isCode('not_found'));
  });

  it('records the completion date and clears it when reopened (GOAL-2)', async () => {
    const { repos, clock } = await setup('2026-08-14T12:00:00');
    const g = await repos.goals.create({ title: 'Run a 10k' });
    const done = await repos.goals.update(g.id, { status: 'completed' });
    expect(done.completedAt).toBe('2026-08-14');

    // Editing a completed goal keeps its original completion date.
    clock.set('2026-08-20T12:00:00');
    expect((await repos.goals.update(g.id, { title: 'Run a 10 km race' })).completedAt).toBe('2026-08-14');

    expect((await repos.goals.update(g.id, { status: 'active' })).completedAt).toBeUndefined();
    expect((await repos.goals.update(g.id, { status: 'completed' })).completedAt).toBe('2026-08-20');

    // The logical day: 01:30 with a 4 a.m. day start still counts as the day before (SET-4).
    clock.set('2026-08-22T01:30:00');
    const late = await repos.goals.create({ title: 'Late', status: 'completed' });
    expect(late.completedAt).toBe('2026-08-21');
  });

  it('patches with null clearing fields and keeps the values of other progress modes', async () => {
    const { repos } = await setup();
    const g = await repos.goals.create({
      title: 'G',
      description: 'd',
      targetDate: '2026-09-01',
      progressManual: 30,
    });
    const numeric = await repos.goals.update(g.id, {
      progressMode: 'numeric',
      progressTarget: 10,
      description: null,
    });
    expect(numeric).toMatchObject({ progressMode: 'numeric', progressTarget: 10, progressManual: 30 });
    expect(numeric.description).toBeUndefined();
    expect(numeric.targetDate).toBe('2026-09-01');
    expect((await repos.goals.update(g.id, { progressMode: 'manual' })).progressManual).toBe(30);
  });

  it('lists in user order, filtered by status and category', async () => {
    const { repos } = await setup();
    const a = await repos.goals.create({ title: 'A', categoryId: DEFAULT_CATEGORY_IDS.health });
    const b = await repos.goals.create({ title: 'B', status: 'paused' });
    const c = await repos.goals.create({ title: 'C', status: 'completed' });
    await repos.goals.reorder([c.id, a.id, b.id]);
    expect((await repos.goals.list()).map((g) => g.title)).toEqual(['C', 'A', 'B']);
    expect((await repos.goals.list({ status: ['active', 'paused'] })).map((g) => g.title)).toEqual([
      'A',
      'B',
    ]);
    expect((await repos.goals.list({ categoryId: null })).map((g) => g.title)).toEqual(['C', 'B']);
    expect((await repos.goals.list({ categoryId: DEFAULT_CATEGORY_IDS.health })).map((g) => g.title)).toEqual(
      ['A'],
    );
  });

  it('soft-deletes the goal with its milestones, links, months and tags (GOAL-7)', async () => {
    const { repos, db } = await setup();
    const h = await repos.habits.create({ name: 'Study', type: 'duration' });
    const tag = await repos.tags.getOrCreate('fr');
    const g = await repos.goals.create({
      title: 'G',
      habitIds: [h.id],
      months: ['2026-08'],
      tagIds: [tag.id],
    });
    await repos.goals.addMilestone(g.id, { title: 'A1' });
    await repos.goals.remove(g.id);

    expect(await repos.goals.get(g.id)).toBeNull();
    expect(await repos.goals.list()).toEqual([]);
    expect(await repos.goals.forMonth('2026-08')).toEqual([]);
    expect(await repos.goals.forHabit(h.id)).toEqual([]);
    expect(await repos.tags.usageCounts()).toEqual(new Map());
    for (const table of ['goal_milestones', 'goal_habits', 'goal_months'])
      expect(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE deleted_at IS NULL`).get()).toEqual({
        n: 0,
      });
    // Rows stay for sync (FC-2).
    expect(db.prepare('SELECT count(*) AS n FROM goals').get()).toEqual({ n: 1 });
    // Search drops the goal and its milestones.
    expect(searchRows(db, '"a1"')).toEqual([]);
  });
});

describe('milestones (GOAL-3, GOAL-7)', () => {
  it('add, edit, tick off, reorder and delete', async () => {
    const { repos, clock } = await setup('2026-08-14T12:00:00');
    const g = await repos.goals.create({ title: 'Learn French' });
    const a1 = await repos.goals.addMilestone(g.id, { title: 'Finish A1', targetDate: '2026-09-30' });
    const a2 = await repos.goals.addMilestone(g.id, { title: 'Finish A2' });
    const b1 = await repos.goals.addMilestone(g.id, { title: 'Finish B1' });
    expect([a1.sortOrder, a2.sortOrder, b1.sortOrder]).toEqual([1, 2, 3]);

    expect(
      (await repos.goals.updateMilestone(a2.id, { title: 'Pass A2', targetDate: '2026-12-01' })).title,
    ).toBe('Pass A2');
    expect((await repos.goals.updateMilestone(a1.id, { targetDate: null })).targetDate).toBeUndefined();

    expect((await repos.goals.setMilestoneDone(a1.id, true)).completedAt).toBe('2026-08-14');
    clock.set('2026-08-20T12:00:00');
    // Ticking an already done milestone keeps its date.
    expect((await repos.goals.setMilestoneDone(a1.id, true)).completedAt).toBe('2026-08-14');
    expect((await repos.goals.setMilestoneDone(a2.id, true)).completedAt).toBe('2026-08-20');
    expect((await repos.goals.setMilestoneDone(a2.id, false)).completedAt).toBeUndefined();

    await repos.goals.reorderMilestones(g.id, [b1.id, a1.id, a2.id]);
    await repos.goals.removeMilestone(a2.id);
    const titles = (await repos.goals.get(g.id))!.milestones.map((m) => m.title);
    expect(titles).toEqual(['Finish B1', 'Finish A1']);
    // New milestones go to the end.
    expect((await repos.goals.addMilestone(g.id, { title: 'C1' })).sortOrder).toBe(3);
  });

  it('validates and reports missing records', async () => {
    const { repos } = await setup();
    const g = await repos.goals.create({ title: 'G' });
    await expect(repos.goals.addMilestone(g.id, { title: '' })).rejects.toSatisfy(isCode('validation'));
    await expect(repos.goals.addMilestone('missing', { title: 'X' })).rejects.toSatisfy(isCode('not_found'));
    await expect(repos.goals.setMilestoneDone('missing', true)).rejects.toSatisfy(isCode('not_found'));
    const m = await repos.goals.addMilestone(g.id, { title: 'X' });
    await repos.goals.removeMilestone(m.id);
    await expect(repos.goals.removeMilestone(m.id)).rejects.toSatisfy(isCode('not_found'));
    await expect(repos.goals.updateMilestone(m.id, { title: 'Y' })).rejects.toSatisfy(isCode('not_found'));
  });

  it('are searchable through the index triggers (SRCH-1)', async () => {
    const { repos, db } = await setup();
    const g = await repos.goals.create({ title: 'Learn French' });
    const m = await repos.goals.addMilestone(g.id, { title: 'Subjonctif' });
    expect(searchRows(db, '"subjonctif"')).toEqual([{ entity_type: 'goal_milestone', entity_id: m.id }]);
    expect(searchRows(db, '"french"')).toEqual([{ entity_type: 'goal', entity_id: g.id }]);
  });
});

describe('goal links', () => {
  it('links habits both ways, in habit order, ignoring deleted habits (GOAL-5)', async () => {
    const { repos } = await setup();
    const study = await repos.habits.create({ name: 'Study', type: 'duration' });
    const listen = await repos.habits.create({ name: 'Podcast', type: 'boolean' });
    const french = await repos.goals.create({ title: 'Learn French', habitIds: [listen.id, study.id] });
    const fit = await repos.goals.create({ title: 'Be fit' });

    expect(french.habitIds).toEqual([study.id, listen.id]);
    await repos.goals.setHabits(fit.id, [study.id]);
    expect((await repos.goals.forHabit(study.id)).map((g) => g.title)).toEqual(['Learn French', 'Be fit']);

    await repos.goals.setHabits(french.id, [listen.id]);
    expect((await repos.goals.forHabit(study.id)).map((g) => g.title)).toEqual(['Be fit']);

    await repos.habits.remove(listen.id);
    expect((await repos.goals.get(french.id))!.habitIds).toEqual([]);
    await expect(repos.goals.setHabits(french.id, [listen.id])).rejects.toSatisfy(isCode('validation'));
  });

  it('marks months and lists a month’s goals (GOAL-6)', async () => {
    const { repos } = await setup();
    const a = await repos.goals.create({ title: 'A', months: ['2026-08'] });
    const b = await repos.goals.create({ title: 'B' });
    await repos.goals.setMonths(b.id, ['2026-09', '2026-08', '2026-08']);
    expect((await repos.goals.forMonth('2026-08')).map((g) => g.title)).toEqual(['A', 'B']);
    expect((await repos.goals.get(b.id))!.months).toEqual(['2026-08', '2026-09']);

    await repos.goals.update(a.id, { months: [] });
    expect((await repos.goals.forMonth('2026-08')).map((g) => g.title)).toEqual(['B']);
    await expect(repos.goals.setMonths(b.id, ['Aug'])).rejects.toSatisfy(isCode('validation'));
    await expect(repos.goals.forMonth('2026-8')).rejects.toSatisfy(isCode('validation'));
  });

  it('link rows use natural IDs and are revived, not duplicated (FC-5)', async () => {
    const { repos, db } = await setup();
    const h = await repos.habits.create({ name: 'Study', type: 'duration' });
    const g = await repos.goals.create({ title: 'G' });
    for (let i = 0; i < 2; i++) {
      await repos.goals.setHabits(g.id, [h.id]);
      await repos.goals.setMonths(g.id, ['2026-08']);
      await repos.goals.setHabits(g.id, []);
      await repos.goals.setMonths(g.id, []);
    }
    await repos.goals.setHabits(g.id, [h.id]);
    await repos.goals.setMonths(g.id, ['2026-08']);
    expect(db.prepare('SELECT id FROM goal_habits').all()).toEqual([
      { id: naturalId('goal_habit', g.id, h.id) },
    ]);
    expect(db.prepare('SELECT id FROM goal_months').all()).toEqual([
      { id: naturalId('goal_month', g.id, '2026-08') },
    ]);
  });

  it('two devices derive the same link IDs (FC-5)', async () => {
    const ids = [];
    for (let i = 0; i < 2; i++) {
      const driver = createNodeDriver();
      await migrate(driver);
      const repos = createRepositories(driver);
      // The same goal and habit IDs, as after a sync.
      driver.db
        .prepare("INSERT INTO goals (id, title, created_at, updated_at) VALUES ('g1', 'G', '', '')")
        .run();
      driver.db
        .prepare(
          `INSERT INTO habits (id, name, type, frequency_type, start_date, created_at, updated_at)
           VALUES ('h1', 'H', 'boolean', 'daily', '2026-01-01', '', '')`,
        )
        .run();
      await repos.goals.setHabits('g1', ['h1']);
      ids.push(driver.db.prepare('SELECT id FROM goal_habits').get());
    }
    expect(ids[0]).toEqual(ids[1]);
  });
});
