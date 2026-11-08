import type {
  Category,
  Habit,
  HabitEntry,
  HabitFrequency,
  HabitTarget,
  HabitType,
  ISODate,
  JournalEntry,
  Priority,
  RatingScale,
  Settings,
  Tag,
  TaggableType,
  UUID,
} from './types';

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
  categoryId?: UUID;
  tagId?: UUID;
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
  get(id: UUID): Promise<JournalEntry | null>;
  create(input: NewJournalEntry): Promise<JournalEntry>;
  update(id: UUID, patch: JournalPatch): Promise<JournalEntry>;
  remove(id: UUID): Promise<void>;
}

// ───────── Settings ─────────

export interface SettingsRepository {
  getAll(): Promise<Settings>;
  get<K extends keyof Settings>(key: K): Promise<Settings[K]>;
  set<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void>;
}

// ───────── Aggregate ─────────

export interface Repositories {
  categories: CategoryRepository;
  tags: TagRepository;
  habits: HabitRepository;
  entries: HabitEntryRepository;
  journal: JournalRepository;
  settings: SettingsRepository;
}
