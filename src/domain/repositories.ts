import type {
  Category,
  Goal,
  GoalStatus,
  Habit,
  HabitEntry,
  HabitFrequency,
  HabitTarget,
  HabitType,
  ISODate,
  ISOMonth,
  JournalEntry,
  LifeEvent,
  Milestone,
  Priority,
  ProgressMode,
  RatingScale,
  Settings,
  Tag,
  TaggableType,
  UUID,
} from './types';
import type { ImportMode, ImportPlan } from './importFile';
import type { ExportFile } from './transfer';

export interface DateRange {
  from: ISODate;
  to: ISODate;
}

// ───────── Categories & tags ─────────

export interface NewCategory {
  name: string;
  color?: string;
  icon?: string;
}
export type CategoryPatch = Partial<NewCategory>;

export interface CategoryRepository {
  list(opts?: { includeArchived?: boolean }): Promise<Category[]>;
  get(id: UUID): Promise<Category | null>;
  create(input: NewCategory): Promise<Category>;
  update(id: UUID, patch: CategoryPatch): Promise<Category>;
  archive(id: UUID, archived: boolean): Promise<void>;
  reorder(idsInOrder: UUID[]): Promise<void>;
  remove(id: UUID): Promise<void>;
}

export interface TagRepository {
  list(): Promise<Tag[]>;
  get(id: UUID): Promise<Tag | null>;
  /** Prefix search for autocomplete (TAG-2). */
  search(prefix: string, limit?: number): Promise<Tag[]>;
  /** Returns the existing tag with this normalized name, or creates it (TAG-2, TAG-3). */
  getOrCreate(name: string): Promise<Tag>;
  rename(id: UUID, name: string): Promise<Tag>;
  /** Moves every tagged record from `sourceId` onto `targetId`, then deletes the source (TAG-4). */
  merge(sourceId: UUID, targetId: UUID): Promise<void>;
  remove(id: UUID): Promise<void>;
  tagsOf(entityType: TaggableType, entityId: UUID): Promise<UUID[]>;
  setTags(entityType: TaggableType, entityId: UUID, tagIds: UUID[]): Promise<void>;
  /** Number of live records carrying each tag; tags with none are absent (TAG-4, TAG-5). */
  usageCounts(): Promise<Map<UUID, number>>;
  /** All records carrying the tag (TAG-5). */
  taggedWith(tagId: UUID): Promise<{ entityType: TaggableType; entityId: UUID }[]>;
}

// ───────── Habits ─────────

export interface NewHabit {
  name: string;
  description?: string;
  type: HabitType;
  unit?: string;
  ratingScale?: RatingScale;
  target?: HabitTarget;
  frequency?: HabitFrequency;
  categoryId?: UUID;
  priority?: Priority;
  /** Defaults to the logical today. */
  startDate?: ISODate;
  endDate?: ISODate;
  tagIds?: UUID[];
}

/** `null` clears an optional field. */
export type HabitPatch = {
  [K in keyof NewHabit]?: NewHabit[K] | null;
};

export interface HabitRepository {
  list(opts?: { includeArchived?: boolean }): Promise<Habit[]>;
  /**
   * Habits relevant to a date range (DAY-1, MON-1, MON-8): not deleted, overlapping the
   * range by start/end date, and either not archived or with entries inside the range.
   */
  activeOn(range: DateRange): Promise<Habit[]>;
  get(id: UUID): Promise<Habit | null>;
  hasEntries(id: UUID): Promise<boolean>;
  create(input: NewHabit): Promise<Habit>;
  /**
   * Throws `type_locked` when changing the type, or a rating habit's scale, of a habit that
   * has entries (HAB-2): existing values would no longer fit.
   */
  update(id: UUID, patch: HabitPatch): Promise<Habit>;
  archive(id: UUID, archived: boolean): Promise<void>;
  /** Soft-deletes the habit and its entries, tags and goal links (HAB-9). */
  remove(id: UUID): Promise<void>;
  reorder(idsInOrder: UUID[]): Promise<void>;
}

export interface HabitEntryRepository {
  forRange(range: DateRange, habitIds?: UUID[]): Promise<HabitEntry[]>;
  get(habitId: UUID, date: ISODate): Promise<HabitEntry | null>;
  /**
   * Sets the value for (habit, date): an upsert on the natural ID that also revives a
   * cleared entry (ENT-1, FC-5). `note: undefined` keeps the existing note, `null` clears it.
   */
  set(habitId: UUID, date: ISODate, value: number, note?: string | null): Promise<HabitEntry>;
  /** Removes the value: "not logged" (ENT-2). */
  clear(habitId: UUID, date: ISODate): Promise<void>;
}

// ───────── Journal ─────────

export interface NewJournalEntry {
  entryDate: ISODate;
  title?: string;
  body?: string;
  categoryId?: UUID;
  tagIds?: UUID[];
}
export type JournalPatch = {
  [K in keyof NewJournalEntry]?: NewJournalEntry[K] | null;
};

export interface JournalFilter {
  from?: ISODate;
  to?: ISODate;
  /** A category, or null for entries without one. */
  categoryId?: UUID | null;
  tagId?: UUID;
}

/** What the journal's filters can offer: categories and tags used by any entry (CAT-5). */
export interface JournalFacets {
  /** Includes null when some entry has no category. */
  categoryIds: (UUID | null)[];
  tagIds: UUID[];
}

export interface JournalCursor {
  entryDate: ISODate;
  createdAt: string;
  id: UUID;
}

export interface JournalPage {
  entries: JournalEntry[];
  next?: JournalCursor;
}

export interface JournalRepository {
  forDate(date: ISODate): Promise<JournalEntry[]>;
  /** Reverse chronological, keyset-paginated (JRN-5). */
  list(filter?: JournalFilter, page?: { after?: JournalCursor; limit?: number }): Promise<JournalPage>;
  /** Categories and tags in use by entries, for the feed's filters. */
  facets(): Promise<JournalFacets>;
  get(id: UUID): Promise<JournalEntry | null>;
  create(input: NewJournalEntry): Promise<JournalEntry>;
  update(id: UUID, patch: JournalPatch): Promise<JournalEntry>;
  remove(id: UUID): Promise<void>;
}

// ───────── Goals ─────────

export interface NewGoal {
  title: string;
  description?: string;
  categoryId?: UUID;
  priority?: Priority;
  /** Defaults to `active` (GOAL-2). */
  status?: GoalStatus;
  /** Defaults to `milestones` (GOAL-4). */
  progressMode?: ProgressMode;
  progressManual?: number;
  progressCurrent?: number;
  progressTarget?: number;
  progressUnit?: string;
  startDate?: ISODate;
  targetDate?: ISODate;
  tagIds?: UUID[];
  habitIds?: UUID[];
  months?: ISOMonth[];
}

/** `null` clears an optional field. */
export type GoalPatch = {
  [K in keyof NewGoal]?: NewGoal[K] | null;
};

export interface GoalFilter {
  status?: GoalStatus[];
  /** A category, or null for goals without one. */
  categoryId?: UUID | null;
}

export interface NewMilestone {
  title: string;
  targetDate?: ISODate;
}
export type MilestonePatch = {
  [K in keyof NewMilestone]?: NewMilestone[K] | null;
};

export interface GoalRepository {
  /** In user order, with milestones, linked habits, months and tags. */
  list(filter?: GoalFilter): Promise<Goal[]>;
  get(id: UUID): Promise<Goal | null>;
  /** Goals marked as goals for this month (GOAL-6, MON-7). */
  forMonth(month: ISOMonth): Promise<Goal[]>;
  /** Goals linked to this habit (GOAL-5). */
  forHabit(habitId: UUID): Promise<Goal[]>;
  create(input: NewGoal): Promise<Goal>;
  /**
   * Becoming `completed` records today's logical date in `completedAt`; leaving it clears
   * the date (GOAL-2). `tagIds`, `habitIds` and `months` replace the whole set when given.
   */
  update(id: UUID, patch: GoalPatch): Promise<Goal>;
  /** Soft-deletes the goal with its milestones, habit links, months and tags (GOAL-7). */
  remove(id: UUID): Promise<void>;
  reorder(idsInOrder: UUID[]): Promise<void>;

  addMilestone(goalId: UUID, input: NewMilestone): Promise<Milestone>;
  updateMilestone(id: UUID, patch: MilestonePatch): Promise<Milestone>;
  /** Done records today's logical date; not done clears it (GOAL-3). */
  setMilestoneDone(id: UUID, done: boolean): Promise<Milestone>;
  reorderMilestones(goalId: UUID, idsInOrder: UUID[]): Promise<void>;
  removeMilestone(id: UUID): Promise<void>;

  /** Makes the goal's linked habits exactly `habitIds` (GOAL-5). Links use natural IDs (FC-5). */
  setHabits(goalId: UUID, habitIds: UUID[]): Promise<void>;
  /** Makes the goal's months exactly `months` (GOAL-6). Rows use natural IDs (FC-5). */
  setMonths(goalId: UUID, months: ISOMonth[]): Promise<void>;
}

// ───────── Life events ─────────

export interface NewLifeEvent {
  name: string;
  description?: string;
  startDate: ISODate;
  /** Last day of a range, inclusive; absent for a one-day event (EVT-1). */
  endDate?: ISODate;
  categoryId?: UUID;
  tagIds?: UUID[];
}
export type LifeEventPatch = {
  [K in keyof NewLifeEvent]?: NewLifeEvent[K] | null;
};

export interface LifeEventRepository {
  /** Newest first (EVT-3). */
  list(): Promise<LifeEvent[]>;
  /** Events covering any day of the range, oldest first (EVT-2, DAY-1, MON-6). */
  overlapping(range: DateRange): Promise<LifeEvent[]>;
  get(id: UUID): Promise<LifeEvent | null>;
  create(input: NewLifeEvent): Promise<LifeEvent>;
  update(id: UUID, patch: LifeEventPatch): Promise<LifeEvent>;
  /** Soft-deletes the event and its tags (EVT-3). */
  remove(id: UUID): Promise<void>;
}

// ───────── Search ─────────

/** The kinds of record search finds (SRCH-1). Milestone matches come back as their goal. */
export type SearchType = 'journal_entry' | 'habit' | 'goal' | 'life_event' | 'tag';

export interface SearchFilters {
  /** Only these kinds; all when empty or absent. */
  types?: SearchType[];
  /**
   * Records from this date range: journal entries by date, events, habits and goals
   * overlapping it. Tags aren't dated, so a date filter leaves them out.
   */
  from?: ISODate;
  to?: ISODate;
  /** A category, or null for records without one. Leaves tags out. */
  categoryId?: UUID | null;
  /** Records carrying this tag. Leaves tags out. */
  tagId?: UUID;
}

export interface SearchHit {
  type: Exclude<SearchType, 'tag'>;
  id: UUID;
  /** Name or title; absent for an untitled journal entry. */
  title?: string;
  /** Text around the match, with matches between MARK_START and MARK_END (searchQuery.ts). */
  snippet: string;
  /** A goal found through one of its milestones: that milestone's title. */
  milestone?: string;
  /** Journal entry date, or an event's first day. */
  date?: ISODate;
  endDate?: ISODate;
  categoryId?: UUID;
  /** Habit archived, or goal status, to show next to the result. */
  archived?: boolean;
  status?: GoalStatus;
}

export interface TagHit {
  id: UUID;
  name: string;
  /** Live records carrying the tag. */
  count: number;
}

export interface SearchResults {
  /** By relevance, then newest first (SRCH-3). */
  hits: SearchHit[];
  tags: TagHit[];
}

export interface SearchRepository {
  /** Full-text search over every record type plus tag names (SRCH-1…4). */
  search(query: string, filters?: SearchFilters, limit?: number): Promise<SearchResults>;
}

// ───────── Settings ─────────

export interface SettingsRepository {
  getAll(): Promise<Settings>;
  get<K extends keyof Settings>(key: K): Promise<Settings[K]>;
  set<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void>;
}

// ───────── Aggregate ─────────

// ───────── Export & import (V1.5) ─────────

export interface TransferRepository {
  /** All data as a Life DB export file (EXP-1). `appVersion` is recorded in the file. */
  exportAll(opts: { appVersion: string }): Promise<ExportFile>;
  /**
   * Checks a parsed export against the app's data and works out what importing it would
   * do (IMP-2, IMP-6). Reads only. Throws DomainError('validation') for a file that
   * can't be imported, e.g. a record pointing to one that is nowhere.
   */
  plan(file: ExportFile, mode: ImportMode): Promise<ImportPlan>;
  /** Imports a planned file in one transaction (IMP-3, IMP-4, IMP-5). */
  apply(plan: ImportPlan): Promise<void>;
}

export interface Repositories {
  categories: CategoryRepository;
  tags: TagRepository;
  habits: HabitRepository;
  entries: HabitEntryRepository;
  journal: JournalRepository;
  goals: GoalRepository;
  events: LifeEventRepository;
  search: SearchRepository;
  settings: SettingsRepository;
  transfer: TransferRepository;
}
