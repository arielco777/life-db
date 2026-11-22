import { setup } from './helpers';
import { DEFAULT_CATEGORY_IDS } from '@/domain/ids';
import { snippetParts } from '@/domain/services/searchQuery';

type Repos = Awaited<ReturnType<typeof setup>>['repos'];

async function seed(repos: Repos) {
  const travel = await repos.tags.getOrCreate('travel');
  const french = await repos.tags.getOrCreate('french');
  await repos.tags.getOrCreate('frenzy');
  const habit = await repos.habits.create({
    name: 'Study French',
    type: 'duration',
    description: 'Duolingo or a podcast',
    startDate: '2026-01-01',
    categoryId: DEFAULT_CATEGORY_IDS.learning,
    tagIds: [french.id],
  });
  const goal = await repos.goals.create({
    title: 'Learn a language',
    description: 'Probably French',
    startDate: '2026-02-01',
    targetDate: '2026-12-31',
    categoryId: DEFAULT_CATEGORY_IDS.learning,
  });
  await repos.goals.addMilestone(goal.id, { title: 'Pass the French A2 exam' });
  const old = await repos.journal.create({
    entryDate: '2025-06-01',
    title: 'Café in Paris',
    body: 'Ordered in French for the first time',
    tagIds: [travel.id, french.id],
  });
  const recent = await repos.journal.create({ entryDate: '2026-08-14', body: 'French class was hard today' });
  const event = await repos.events.create({
    name: 'Trip to Lyon',
    description: 'Speaking French all week',
    startDate: '2026-07-01',
    endDate: '2026-07-07',
    tagIds: [travel.id],
  });
  return { habit, goal, old, recent, event, travel, french };
}

describe('search (SRCH)', () => {
  it('finds every record type by word prefix, case- and accent-insensitively (SRCH-1, SRCH-3)', async () => {
    const { repos } = await setup();
    const s = await seed(repos);
    const { hits, tags } = await repos.search.search('FREN');
    expect(new Set(hits.map((h) => `${h.type}:${h.id}`))).toEqual(
      new Set([
        `habit:${s.habit.id}`,
        `goal:${s.goal.id}`,
        `journal_entry:${s.old.id}`,
        `journal_entry:${s.recent.id}`,
        `life_event:${s.event.id}`,
      ]),
    );
    expect(tags.map((t) => t.name)).toEqual(['french', 'frenzy']);
    expect(tags[0]!.count).toBe(2);

    // Diacritics: "cafe" finds "Café".
    expect((await repos.search.search('cafe')).hits.map((h) => h.title)).toEqual(['Café in Paris']);
    // All words must match.
    expect((await repos.search.search('french lyon')).hits.map((h) => h.id)).toEqual([s.event.id]);
    expect((await repos.search.search('zzz')).hits).toEqual([]);
    expect(await repos.search.search('  "*  ')).toEqual({ hits: [], tags: [] });
  });

  it('returns titles, dates and a highlighted snippet (SRCH-2)', async () => {
    const { repos } = await setup();
    const s = await seed(repos);
    const { hits } = await repos.search.search('class');
    expect(hits).toHaveLength(1);
    const [hit] = hits;
    expect(hit).toMatchObject({ type: 'journal_entry', id: s.recent.id, date: '2026-08-14' });
    expect(hit!.title).toBeUndefined(); // untitled entry
    expect(snippetParts(hit!.snippet)).toEqual([
      { text: 'French ', match: false },
      { text: 'class', match: true },
      { text: ' was hard today', match: false },
    ]);
    const lyon = (await repos.search.search('lyon')).hits[0];
    expect(lyon).toMatchObject({ title: 'Trip to Lyon', date: '2026-07-01', endDate: '2026-07-07' });
  });

  it('a milestone match returns its goal once, naming the milestone', async () => {
    const { repos } = await setup();
    const s = await seed(repos);
    const exam = (await repos.search.search('exam')).hits;
    expect(exam).toEqual([
      expect.objectContaining({
        type: 'goal',
        id: s.goal.id,
        title: 'Learn a language',
        milestone: 'Pass the French A2 exam',
      }),
    ]);
    // The goal matches directly and through its milestone; it is listed once.
    expect((await repos.search.search('french')).hits.filter((h) => h.type === 'goal')).toHaveLength(1);
  });

  it('ranks title matches first, then newer journal entries (SRCH-3)', async () => {
    const { repos } = await setup();
    await repos.journal.create({ entryDate: '2026-01-01', body: 'a note about gardening' });
    await repos.journal.create({ entryDate: '2026-03-01', body: 'a note about gardening' });
    const titled = await repos.journal.create({ entryDate: '2025-01-01', title: 'Gardening', body: 'x' });
    const dates = (await repos.search.search('gardening')).hits.map((h) => h.date);
    expect(dates[0]).toBe(titled.entryDate);
    expect(dates.slice(1)).toEqual(['2026-03-01', '2026-01-01']);
  });

  it('filters by type, date range, category and tag (SRCH-4)', async () => {
    const { repos } = await setup();
    const s = await seed(repos);
    const ids = async (f: Parameters<Repos['search']['search']>[1]) =>
      new Set((await repos.search.search('french', f)).hits.map((h) => h.id));

    expect(await ids({ types: ['journal_entry'] })).toEqual(new Set([s.old.id, s.recent.id]));
    expect((await repos.search.search('french', { types: ['tag'] })).hits).toEqual([]);
    expect((await repos.search.search('french', { types: ['habit'] })).tags).toEqual([]);

    // August 2026: the August entry, the habit running then, the goal in progress; not the
    // July trip or the 2025 entry.
    expect(await ids({ from: '2026-08-01', to: '2026-08-31' })).toEqual(
      new Set([s.recent.id, s.habit.id, s.goal.id]),
    );
    expect(await ids({ from: '2026-07-07', to: '2026-07-07' })).toEqual(
      new Set([s.event.id, s.habit.id, s.goal.id]),
    );
    expect(await ids({ to: '2025-12-31' })).toEqual(new Set([s.old.id]));

    expect(await ids({ categoryId: DEFAULT_CATEGORY_IDS.learning })).toEqual(
      new Set([s.habit.id, s.goal.id]),
    );
    expect(await ids({ categoryId: null })).toEqual(new Set([s.old.id, s.recent.id, s.event.id]));
    expect(await ids({ tagId: s.travel.id })).toEqual(new Set([s.old.id, s.event.id]));

    // Filters that tags can't satisfy leave tags out.
    expect((await repos.search.search('french', { tagId: s.travel.id })).tags).toEqual([]);
  });

  it('drops deleted records and follows edits (index triggers)', async () => {
    const { repos } = await setup();
    const s = await seed(repos);
    await repos.journal.remove(s.recent.id);
    await repos.events.update(s.event.id, { name: 'Trip to Nice', description: null });
    await repos.goals.remove(s.goal.id);
    const ids = new Set((await repos.search.search('french')).hits.map((h) => h.id));
    expect(ids).toEqual(new Set([s.habit.id, s.old.id]));
    expect((await repos.search.search('nice')).hits.map((h) => h.id)).toEqual([s.event.id]);
    expect((await repos.search.search('exam')).hits).toEqual([]);
  });

  it('marks archived habits and goal statuses, and escapes LIKE wildcards in tag search', async () => {
    const { repos } = await setup();
    const h = await repos.habits.create({ name: 'Old habit', type: 'boolean' });
    await repos.habits.archive(h.id, true);
    await repos.goals.create({ title: 'Old goal', status: 'abandoned' });
    await repos.tags.getOrCreate('100%');
    await repos.tags.getOrCreate('1000');
    const { hits } = await repos.search.search('old');
    expect(hits.find((x) => x.type === 'habit')).toMatchObject({ archived: true });
    expect(hits.find((x) => x.type === 'goal')).toMatchObject({ status: 'abandoned' });
    expect((await repos.search.search('100')).tags.map((t) => t.name)).toEqual(['100%', '1000']);
  });
});
