import { createNodeDriver } from './nodeDriver';
import { setup } from './helpers';
import { createRepositories, migrate } from '@/data/sqlite';
import { entryId } from '@/data/sqlite/repositories/entries';
import { isDomainError } from '@/domain/errors';
import { DEFAULT_CATEGORY_IDS, naturalId } from '@/domain/ids';

const searchRows = (db: ReturnType<typeof createNodeDriver>['db'], q: string) =>
  db.prepare('SELECT entity_type, entity_id FROM search_index WHERE search_index MATCH ?').all(q) as {
    entity_type: string;
    entity_id: string;
  }[];

describe('categories', () => {
  it('create, rename, archive, reorder, delete', async () => {
    const { repos } = await setup();
    const c = await repos.categories.create({ name: 'Fitness', color: '#123456' });
    expect(c.sortOrder).toBe(9);
    expect((await repos.categories.update(c.id, { name: 'Sport' })).name).toBe('Sport');
    await repos.categories.archive(c.id, true);
    expect((await repos.categories.list()).find((x) => x.id === c.id)).toBeUndefined();
    expect((await repos.categories.list({ includeArchived: true })).find((x) => x.id === c.id)).toBeDefined();
    await repos.categories.remove(c.id);
    expect(await repos.categories.get(c.id)).toBeNull();
  });

  it('names are unique case-insensitively, but reusable after delete (CAT-4)', async () => {
    const { repos } = await setup();
    await expect(repos.categories.create({ name: 'health' })).rejects.toSatisfy((e) =>
      isDomainError(e, 'conflict'),
    );
    await repos.categories.remove(DEFAULT_CATEGORY_IDS.health);
    await expect(repos.categories.create({ name: 'Health' })).resolves.toBeDefined();
  });

  it('rejects an empty name', async () => {
    const { repos } = await setup();
    await expect(repos.categories.create({ name: '  ' })).rejects.toSatisfy((e) =>
      isDomainError(e, 'validation'),
    );
  });
});

describe('tags', () => {
  it('normalizes names and getOrCreate is idempotent (TAG-2, TAG-3)', async () => {
    const { repos } = await setup();
    const a = await repos.tags.getOrCreate('  Stress  ');
    const b = await repos.tags.getOrCreate('stress');
    expect(a.name).toBe('stress');
    expect(b.id).toBe(a.id);
    expect((await repos.tags.search('STR')).map((t) => t.name)).toEqual(['stress']);
  });

  it('prefix search escapes LIKE wildcards', async () => {
    const { repos } = await setup();
    await repos.tags.getOrCreate('100%');
    await repos.tags.getOrCreate('1000');
    expect((await repos.tags.search('100%')).map((t) => t.name)).toEqual(['100%']);
  });

  it('setTags uses natural IDs and revives links instead of duplicating them (FC-5)', async () => {
    const { repos, db } = await setup();
    const h = await repos.habits.create({ name: 'Run', type: 'boolean' });
    const t = await repos.tags.getOrCreate('cardio');
    await repos.tags.setTags('habit', h.id, [t.id]);
    await repos.tags.setTags('habit', h.id, []);
    await repos.tags.setTags('habit', h.id, [t.id]);
    const rows = db.prepare('SELECT id, deleted_at FROM entity_tags').all() as {
      id: string;
      deleted_at: string | null;
    }[];
    expect(rows).toEqual([{ id: naturalId('entity_tag', t.id, 'habit', h.id), deleted_at: null }]);
    expect(await repos.tags.tagsOf('habit', h.id)).toEqual([t.id]);
  });

  it('rename refuses an existing name; merge moves every record (TAG-4)', async () => {
    const { repos } = await setup();
    const money = await repos.tags.getOrCreate('money');
    const finance = await repos.tags.getOrCreate('finance');
    const j1 = await repos.journal.create({ entryDate: '2026-08-14', body: 'a', tagIds: [money.id] });
    const j2 = await repos.journal.create({
      entryDate: '2026-08-15',
      body: 'b',
      tagIds: [money.id, finance.id],
    });
    await expect(repos.tags.rename(finance.id, 'Money')).rejects.toSatisfy((e) =>
      isDomainError(e, 'conflict'),
    );

    await repos.tags.merge(finance.id, money.id);
    expect(await repos.tags.get(finance.id)).toBeNull();
    expect((await repos.journal.get(j1.id))!.tagIds).toEqual([money.id]);
    expect((await repos.journal.get(j2.id))!.tagIds).toEqual([money.id]);
    expect(await repos.tags.taggedWith(money.id)).toHaveLength(2);
  });

  it('usageCounts counts live links only', async () => {
    const { repos } = await setup();
    const a = await repos.tags.getOrCreate('a');
    const b = await repos.tags.getOrCreate('b');
    await repos.tags.getOrCreate('unused');
    const h = await repos.habits.create({ name: 'Run', type: 'boolean', tagIds: [a.id, b.id] });
    const j = await repos.journal.create({ entryDate: '2026-08-14', tagIds: [a.id] });
    await repos.journal.remove(j.id);
    await repos.journal.create({ entryDate: '2026-08-15', tagIds: [a.id] });
    await repos.tags.setTags('habit', h.id, [a.id]);
    expect(Object.fromEntries(await repos.tags.usageCounts())).toEqual({ [a.id]: 2 });
  });

  it('remove hides the tag from every record', async () => {
    const { repos } = await setup();
    const t = await repos.tags.getOrCreate('temp');
    const j = await repos.journal.create({ entryDate: '2026-08-14', tagIds: [t.id] });
    await repos.tags.remove(t.id);
    expect((await repos.journal.get(j.id))!.tagIds).toEqual([]);
    // Name is reusable afterwards.
    expect((await repos.tags.getOrCreate('temp')).id).not.toBe(t.id);
  });
});

describe('habits', () => {
  it('creates with defaults; start date is the logical today (SET-4)', async () => {
    const { repos, clock } = await setup();
    clock.set('2026-08-15T01:30:00'); // before the default 4 a.m. day start
    const h = await repos.habits.create({ name: 'Exercise', type: 'boolean' });
    expect(h).toMatchObject({
      priority: 'medium',
      frequency: { type: 'daily' },
      startDate: '2026-08-14',
      sortOrder: 1,
    });
    expect((await repos.habits.create({ name: 'Mood', type: 'rating' })).ratingScale).toEqual({
      min: 1,
      max: 10,
    });
  });

  it('stores frequency, target, unit and tags', async () => {
    const { repos } = await setup();
    const t = await repos.tags.getOrCreate('morning');
    const h = await repos.habits.create({
      name: 'Coffee',
      type: 'number',
      unit: 'cups',
      target: { value: 2, op: 'at_most', period: 'day' },
      frequency: { type: 'weekdays', days: ['mon', 'wed', 'fri'] },
      categoryId: DEFAULT_CATEGORY_IDS.health,
      tagIds: [t.id],
      startDate: '2026-08-01',
    });
    expect(await repos.habits.get(h.id)).toMatchObject({
      unit: 'cups',
      target: { value: 2, op: 'at_most', period: 'day' },
      frequency: { type: 'weekdays', days: ['mon', 'wed', 'fri'] },
      categoryId: DEFAULT_CATEGORY_IDS.health,
      tagIds: [t.id],
    });
  });

  it('validates input (HAB-1)', async () => {
    const { repos } = await setup();
    const bad = [
      { name: '', type: 'boolean' },
      { name: 'x', type: 'bogus' },
      { name: 'x', type: 'boolean', startDate: '2026-02-30' },
      { name: 'x', type: 'boolean', startDate: '2026-08-10', endDate: '2026-08-01' },
      { name: 'x', type: 'rating', ratingScale: { min: 5, max: 5 } },
    ];
    for (const input of bad)
      await expect(repos.habits.create(input as never)).rejects.toSatisfy((e) =>
        isDomainError(e, 'validation'),
      );
  });

  it('locks the type once entries exist (HAB-2)', async () => {
    const { repos } = await setup();
    const h = await repos.habits.create({ name: 'Sleep', type: 'number', startDate: '2026-08-01' });
    expect((await repos.habits.update(h.id, { type: 'duration' })).type).toBe('duration');
    await repos.entries.set(h.id, '2026-08-02', 420);
    await expect(repos.habits.update(h.id, { type: 'rating' })).rejects.toSatisfy((e) =>
      isDomainError(e, 'type_locked'),
    );
    expect((await repos.habits.update(h.id, { name: 'Sleep time', description: null })).name).toBe(
      'Sleep time',
    );
  });

  it('update with null clears optional fields', async () => {
    const { repos } = await setup();
    const h = await repos.habits.create({
      name: 'Read',
      type: 'duration',
      target: { value: 30, op: 'at_least', period: 'day' },
      endDate: '2027-01-01',
      startDate: '2026-01-01',
    });
    const u = await repos.habits.update(h.id, { target: null, endDate: null });
    expect(u.target).toBeUndefined();
    expect(u.endDate).toBeUndefined();
  });

  it('activeOn respects start/end dates and hides archived habits without entries (MON-8)', async () => {
    const { repos } = await setup();
    const aug = { from: '2026-08-01', to: '2026-08-31' };
    const a = await repos.habits.create({ name: 'A', type: 'boolean', startDate: '2026-07-01' });
    await repos.habits.create({ name: 'Future', type: 'boolean', startDate: '2026-09-01' });
    await repos.habits.create({
      name: 'Ended',
      type: 'boolean',
      startDate: '2026-01-01',
      endDate: '2026-07-31',
    });
    const archivedWithData = await repos.habits.create({
      name: 'Old',
      type: 'boolean',
      startDate: '2026-01-01',
    });
    const archivedNoData = await repos.habits.create({
      name: 'Unused',
      type: 'boolean',
      startDate: '2026-01-01',
    });
    await repos.entries.set(archivedWithData.id, '2026-08-03', 1);
    await repos.habits.archive(archivedWithData.id, true);
    await repos.habits.archive(archivedNoData.id, true);

    expect((await repos.habits.activeOn(aug)).map((h) => h.name)).toEqual(['A', 'Old']);
    expect(
      (await repos.habits.activeOn({ from: '2026-09-01', to: '2026-09-30' })).map((h) => h.name),
    ).toEqual(['A', 'Future']);
    expect((await repos.habits.list()).map((h) => h.id)).not.toContain(archivedWithData.id);
    void a;
  });

  it('reorders', async () => {
    const { repos } = await setup();
    const a = await repos.habits.create({ name: 'A', type: 'boolean' });
    const b = await repos.habits.create({ name: 'B', type: 'boolean' });
    await repos.habits.reorder([b.id, a.id]);
    expect((await repos.habits.list()).map((h) => h.name)).toEqual(['B', 'A']);
  });

  it('remove soft-deletes the habit, its entries and tag links (HAB-9)', async () => {
    const { repos, db } = await setup();
    const t = await repos.tags.getOrCreate('x');
    const h = await repos.habits.create({
      name: 'Gone',
      type: 'boolean',
      startDate: '2026-08-01',
      tagIds: [t.id],
    });
    await repos.entries.set(h.id, '2026-08-02', 1);
    await repos.habits.remove(h.id);
    expect(await repos.habits.get(h.id)).toBeNull();
    expect(await repos.entries.forRange({ from: '2026-08-01', to: '2026-08-31' })).toEqual([]);
    expect(await repos.tags.taggedWith(t.id)).toEqual([]);
    // Rows still exist physically, for future sync (FC-2).
    expect(db.prepare('SELECT count(*) AS n FROM habit_entries').get()).toEqual({ n: 1 });
  });
});

describe('habit entries', () => {
  it('set is an upsert keyed by the natural ID (ENT-1, FC-5)', async () => {
    const { repos } = await setup();
    const h = await repos.habits.create({ name: 'Coffee', type: 'number', startDate: '2026-08-01' });
    const e1 = await repos.entries.set(h.id, '2026-08-14', 2);
    const e2 = await repos.entries.set(h.id, '2026-08-14', 3);
    expect(e1.id).toBe(entryId(h.id, '2026-08-14'));
    expect(e2.id).toBe(e1.id);
    expect(e2.value).toBe(3);
    expect(await repos.entries.forRange({ from: '2026-08-14', to: '2026-08-14' })).toHaveLength(1);
  });

  it('set → clear → set revives the same row (ENT-2, FC-5)', async () => {
    const { repos, db } = await setup();
    const h = await repos.habits.create({ name: 'Run', type: 'boolean', startDate: '2026-08-01' });
    await repos.entries.set(h.id, '2026-08-14', 1, 'felt great');
    await repos.entries.clear(h.id, '2026-08-14');
    expect(await repos.entries.get(h.id, '2026-08-14')).toBeNull();
    const revived = await repos.entries.set(h.id, '2026-08-14', 1);
    expect(revived.id).toBe(entryId(h.id, '2026-08-14'));
    expect(revived.note).toBeUndefined(); // a cleared entry's old note does not come back
    expect(db.prepare('SELECT count(*) AS n FROM habit_entries').get()).toEqual({ n: 1 });
  });

  it('two separate databases derive the same entry ID for the same habit and date (FC-5)', async () => {
    // Simulate one synced habit that exists on two devices.
    const habitId = '0190a6e0-1111-7000-8000-000000000001';
    const device = async () => {
      const d = createNodeDriver();
      await migrate(d);
      await d.execute(
        `INSERT INTO habits (id, name, type, start_date, created_at, updated_at)
         VALUES (?, 'Coffee', 'number', '2026-08-01', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
        [habitId],
      );
      return createRepositories(d);
    };
    const [laptop, phone] = [await device(), await device()];
    const a = await laptop.entries.set(habitId, '2026-08-14', 2);
    const b = await phone.entries.set(habitId, '2026-08-14', 3);
    expect(a.id).toBe(b.id);
    expect(a.id).toBe(naturalId('habit_entry', habitId, '2026-08-14'));
  });

  it('note: undefined keeps, null clears', async () => {
    const { repos } = await setup();
    const h = await repos.habits.create({ name: 'Sleep', type: 'duration', startDate: '2026-08-01' });
    await repos.entries.set(h.id, '2026-08-14', 420, 'late night');
    expect((await repos.entries.set(h.id, '2026-08-14', 400)).note).toBe('late night');
    expect((await repos.entries.set(h.id, '2026-08-14', 400, null)).note).toBeUndefined();
  });

  it('validates values by habit type (ENT-4)', async () => {
    const { repos } = await setup();
    const bool = await repos.habits.create({ name: 'B', type: 'boolean' });
    const dur = await repos.habits.create({ name: 'D', type: 'duration' });
    const rate = await repos.habits.create({ name: 'R', type: 'rating', ratingScale: { min: 1, max: 5 } });
    const num = await repos.habits.create({ name: 'N', type: 'number' });
    const cases: [string, number][] = [
      [bool.id, 2],
      [dur.id, 1.5],
      [dur.id, -1],
      [rate.id, 6],
      [rate.id, 0],
      [num.id, -0.5],
      [num.id, Number.NaN],
    ];
    for (const [id, v] of cases)
      await expect(repos.entries.set(id, '2026-08-14', v)).rejects.toSatisfy((e) =>
        isDomainError(e, 'validation'),
      );
    await expect(repos.entries.set(num.id, '2026-02-30', 1)).rejects.toSatisfy((e) =>
      isDomainError(e, 'validation'),
    );
    await expect(repos.entries.set(num.id, '2026-08-14', 2.5)).resolves.toMatchObject({ value: 2.5 });
  });

  it('forRange filters by date range and habit IDs', async () => {
    const { repos } = await setup();
    const a = await repos.habits.create({ name: 'A', type: 'boolean', startDate: '2026-07-01' });
    const b = await repos.habits.create({ name: 'B', type: 'boolean', startDate: '2026-07-01' });
    for (const d of ['2026-07-31', '2026-08-01', '2026-08-31', '2026-09-01']) {
      await repos.entries.set(a.id, d, 1);
      await repos.entries.set(b.id, d, 1);
    }
    const aug = { from: '2026-08-01', to: '2026-08-31' };
    expect(await repos.entries.forRange(aug)).toHaveLength(4);
    expect((await repos.entries.forRange(aug, [a.id])).map((e) => e.date)).toEqual([
      '2026-08-01',
      '2026-08-31',
    ]);
    expect(await repos.entries.forRange(aug, [])).toEqual([]);
  });
});

describe('journal', () => {
  it('allows many entries per day and keeps entry_date separate from created_at (JRN-2, JRN-3)', async () => {
    const { repos, clock } = await setup();
    const a = await repos.journal.create({ entryDate: '2026-08-14', body: 'Morning' });
    clock.advance();
    const b = await repos.journal.create({ entryDate: '2026-08-14', title: 'Evening', body: 'Later' });
    expect((await repos.journal.forDate('2026-08-14')).map((e) => e.id)).toEqual([a.id, b.id]);
    clock.advance();
    const moved = await repos.journal.update(a.id, { entryDate: '2026-08-10' });
    expect(moved.entryDate).toBe('2026-08-10');
    expect(moved.createdAt).toBe(a.createdAt);
    expect(moved.updatedAt > a.updatedAt).toBe(true);
  });

  it('lists reverse-chronologically with keyset pagination and filters (JRN-5)', async () => {
    const { repos, clock } = await setup();
    const t = await repos.tags.getOrCreate('travel');
    for (let d = 1; d <= 9; d++) {
      clock.advance();
      await repos.journal.create({
        entryDate: `2026-08-0${d}`,
        body: `day ${d}`,
        tagIds: d % 3 === 0 ? [t.id] : [],
        categoryId: d % 2 === 0 ? DEFAULT_CATEGORY_IDS.work : undefined,
      });
    }
    const p1 = await repos.journal.list({}, { limit: 4 });
    expect(p1.entries.map((e) => e.entryDate)).toEqual([
      '2026-08-09',
      '2026-08-08',
      '2026-08-07',
      '2026-08-06',
    ]);
    const p2 = await repos.journal.list({}, { after: p1.next, limit: 4 });
    expect(p2.entries.map((e) => e.entryDate)).toEqual([
      '2026-08-05',
      '2026-08-04',
      '2026-08-03',
      '2026-08-02',
    ]);
    const p3 = await repos.journal.list({}, { after: p2.next, limit: 4 });
    expect(p3.entries.map((e) => e.entryDate)).toEqual(['2026-08-01']);
    expect(p3.next).toBeUndefined();

    expect((await repos.journal.list({ tagId: t.id })).entries.map((e) => e.entryDate)).toEqual([
      '2026-08-09',
      '2026-08-06',
      '2026-08-03',
    ]);
    expect(
      (
        await repos.journal.list({
          categoryId: DEFAULT_CATEGORY_IDS.work,
          from: '2026-08-04',
          to: '2026-08-07',
        })
      ).entries,
    ).toHaveLength(2);
  });

  it('keeps the search index in sync, including soft deletes', async () => {
    const { repos, db } = await setup();
    const e = await repos.journal.create({ entryDate: '2026-08-14', body: 'Practised my français today' });
    expect(searchRows(db, '"francais"')).toEqual([{ entity_type: 'journal_entry', entity_id: e.id }]); // diacritics-insensitive
    expect(searchRows(db, '"fran"*')).toHaveLength(1); // prefix
    await repos.journal.update(e.id, { body: 'Nothing here' });
    expect(searchRows(db, '"francais"')).toHaveLength(0);
    await repos.journal.remove(e.id);
    expect(searchRows(db, '"nothing"')).toHaveLength(0);
  });

  it('indexes habits by name for search', async () => {
    const { repos, db } = await setup();
    const h = await repos.habits.create({ name: 'Study French', type: 'duration' });
    expect(searchRows(db, '"fren"*')).toEqual([{ entity_type: 'habit', entity_id: h.id }]);
    await repos.habits.remove(h.id);
    expect(searchRows(db, '"fren"*')).toHaveLength(0);
  });
});

describe('settings', () => {
  it('returns defaults, persists valid values and rejects invalid ones', async () => {
    const { repos } = await setup();
    expect(await repos.settings.get('day_start_hour')).toBe(4);
    await repos.settings.set('day_start_hour', 0);
    await repos.settings.set('week_start', 'sun');
    expect(await repos.settings.getAll()).toMatchObject({
      day_start_hour: 0,
      week_start: 'sun',
      theme: 'system',
    });
    await expect(repos.settings.set('day_start_hour', 7)).rejects.toSatisfy((e) =>
      isDomainError(e, 'validation'),
    );
  });

  it('day_start_hour drives the logical today used for defaults', async () => {
    const { repos, clock } = await setup();
    clock.set('2026-08-15T01:30:00');
    await repos.settings.set('day_start_hour', 0);
    expect((await repos.habits.create({ name: 'X', type: 'boolean' })).startDate).toBe('2026-08-15');
  });
});
