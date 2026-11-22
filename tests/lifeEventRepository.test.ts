import { setup } from './helpers';
import { isDomainError } from '@/domain/errors';
import { DEFAULT_CATEGORY_IDS } from '@/domain/ids';

const isCode = (code: Parameters<typeof isDomainError>[1]) => (e: unknown) => isDomainError(e, code);

describe('life events (EVT)', () => {
  it('creates one-day and range events with category and tags (EVT-1)', async () => {
    const { repos } = await setup();
    const tag = await repos.tags.getOrCreate('travel');
    const trip = await repos.events.create({
      name: '  Vacation in Lisbon ',
      description: 'With Ana',
      startDate: '2026-08-10',
      endDate: '2026-08-17',
      categoryId: DEFAULT_CATEGORY_IDS.leisure,
      tagIds: [tag.id],
    });
    expect(trip).toMatchObject({
      name: 'Vacation in Lisbon',
      startDate: '2026-08-10',
      endDate: '2026-08-17',
      categoryId: DEFAULT_CATEGORY_IDS.leisure,
      tagIds: [tag.id],
    });
    expect(await repos.events.get(trip.id)).toEqual(trip);

    // An end date equal to the start is a one-day event.
    const day = await repos.events.create({ name: 'Moved', startDate: '2026-09-01', endDate: '2026-09-01' });
    expect(day.endDate).toBeUndefined();
  });

  it('refuses an end before the start, a missing name or a bad date', async () => {
    const { repos } = await setup();
    await expect(
      repos.events.create({ name: 'X', startDate: '2026-08-10', endDate: '2026-08-09' }),
    ).rejects.toSatisfy(isCode('validation'));
    await expect(repos.events.create({ name: ' ', startDate: '2026-08-10' })).rejects.toSatisfy(
      isCode('validation'),
    );
    await expect(repos.events.create({ name: 'X', startDate: '2026-02-30' })).rejects.toSatisfy(
      isCode('validation'),
    );
    const e = await repos.events.create({ name: 'X', startDate: '2026-08-10', endDate: '2026-08-12' });
    await expect(repos.events.update(e.id, { startDate: '2026-08-20' })).rejects.toSatisfy(
      isCode('validation'),
    );
    await expect(repos.events.update('missing', { name: 'Y' })).rejects.toSatisfy(isCode('not_found'));
  });

  it('finds events covering any day of a range (EVT-2)', async () => {
    const { repos } = await setup();
    await repos.events.create({ name: 'Trip', startDate: '2026-07-28', endDate: '2026-08-03' });
    await repos.events.create({ name: 'Birthday', startDate: '2026-08-14' });
    await repos.events.create({ name: 'Course', startDate: '2026-08-31', endDate: '2026-09-04' });
    await repos.events.create({ name: 'Earlier', startDate: '2026-07-01', endDate: '2026-07-27' });
    await repos.events.create({ name: 'Later', startDate: '2026-09-01' });
    const names = async (from: string, to: string) =>
      (await repos.events.overlapping({ from, to })).map((e) => e.name);

    expect(await names('2026-08-01', '2026-08-31')).toEqual(['Trip', 'Birthday', 'Course']);
    expect(await names('2026-08-14', '2026-08-14')).toEqual(['Birthday']);
    expect(await names('2026-08-03', '2026-08-03')).toEqual(['Trip']); // last day counts
    expect(await names('2026-08-04', '2026-08-13')).toEqual([]);
  });

  it('lists newest first, edits with null clearing fields, and soft-deletes with tags (EVT-3)', async () => {
    const { repos, db } = await setup();
    const tag = await repos.tags.getOrCreate('family');
    const a = await repos.events.create({
      name: 'A',
      startDate: '2025-05-01',
      description: 'd',
      tagIds: [tag.id],
    });
    await repos.events.create({ name: 'B', startDate: '2026-01-10' });
    await repos.events.create({ name: 'C', startDate: '2025-12-31', endDate: '2026-01-02' });
    expect((await repos.events.list()).map((e) => e.name)).toEqual(['B', 'C', 'A']);

    const edited = await repos.events.update(a.id, { description: null, endDate: '2025-05-03', tagIds: [] });
    expect(edited.description).toBeUndefined();
    expect(edited.endDate).toBe('2025-05-03');
    expect(edited.tagIds).toEqual([]);
    expect((await repos.events.update(a.id, { endDate: null })).endDate).toBeUndefined();

    await repos.events.update(a.id, { tagIds: [tag.id] });
    await repos.events.remove(a.id);
    expect(await repos.events.get(a.id)).toBeNull();
    expect((await repos.events.list()).map((e) => e.name)).toEqual(['B', 'C']);
    expect(await repos.tags.usageCounts()).toEqual(new Map());
    expect(db.prepare('SELECT count(*) AS n FROM life_events').get()).toEqual({ n: 3 }); // kept for sync
  });

  it('are searchable, and drop out of search when deleted', async () => {
    const { repos, db } = await setup();
    const e = await repos.events.create({ name: 'Vacation in Lisbon', startDate: '2026-08-10' });
    const find = () =>
      db.prepare(`SELECT entity_id FROM search_index WHERE search_index MATCH '"lisbon"'`).all();
    expect(find()).toEqual([{ entity_id: e.id }]);
    await repos.events.remove(e.id);
    expect(find()).toEqual([]);
  });
});
