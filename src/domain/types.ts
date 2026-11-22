/** Local calendar date, `YYYY-MM-DD`. Never time-zone shifted (NFR-11). */
export type ISODate = string;
/** Local calendar month, `YYYY-MM`. */
export type ISOMonth = string;
/** ISO-8601 UTC timestamp, e.g. `2026-08-14T09:30:00.000Z`. */
export type Timestamp = string;
export type UUID = string;

export type Priority = 'low' | 'medium' | 'high';
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export type HabitType = 'boolean' | 'number' | 'duration' | 'rating';

export interface HabitTarget {
  value: number;
  op: 'at_least' | 'at_most';
  period: 'day' | 'week' | 'month';
}

export type HabitFrequency =
  | { type: 'daily' }
  | {
      type: 'weekdays';
      days: Weekday[];
      /**
       * HAB-5. The other days are rest days — the habit shouldn't be done on them. Logging
       * one is still allowed but flagged. Absent/false: the other days are optional.
       */
      restOnOtherDays?: boolean;
    }
  | { type: 'times_per_week'; count: number };

export interface RatingScale {
  min: number;
  max: number;
}

export interface Habit {
  id: UUID;
  name: string;
  description?: string;
  type: HabitType;
  /** Number habits only (HAB-3). */
  unit?: string;
  /** Rating habits only. */
  ratingScale?: RatingScale;
  target?: HabitTarget;
  frequency: HabitFrequency;
  categoryId?: UUID;
  priority: Priority;
  startDate: ISODate;
  endDate?: ISODate;
  archivedAt?: Timestamp;
  sortOrder: number;
  tagIds: UUID[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * One observation of a habit on one date.
 * Encoding: boolean 0/1 · number as-is · duration in whole minutes · rating integer in scale.
 */
export interface HabitEntry {
  id: UUID;
  habitId: UUID;
  date: ISODate;
  value: number;
  note?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Category {
  id: UUID;
  name: string;
  color?: string;
  icon?: string;
  sortOrder: number;
  isDefault: boolean;
  archivedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Tag {
  id: UUID;
  name: string;
  color?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type TaggableType = 'habit' | 'goal' | 'journal_entry' | 'life_event';

export interface JournalEntry {
  id: UUID;
  entryDate: ISODate;
  title?: string;
  body: string;
  categoryId?: UUID;
  tagIds: UUID[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type GoalStatus = 'not_started' | 'active' | 'paused' | 'completed' | 'abandoned';
export const GOAL_STATUSES: readonly GoalStatus[] = [
  'not_started',
  'active',
  'paused',
  'completed',
  'abandoned',
];

/** GOAL-4: how a goal's progress is measured. */
export type ProgressMode = 'milestones' | 'manual' | 'numeric';

export interface Milestone {
  id: UUID;
  goalId: UUID;
  title: string;
  targetDate?: ISODate;
  /** Logical date the milestone was ticked off; absent while not done (GOAL-3). */
  completedAt?: ISODate;
  sortOrder: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Goal {
  id: UUID;
  title: string;
  description?: string;
  categoryId?: UUID;
  priority: Priority;
  status: GoalStatus;
  progressMode: ProgressMode;
  /** `manual` mode: 0–100. Kept when switching modes, so switching back restores it. */
  progressManual?: number;
  /** `numeric` mode: current / target with a unit, e.g. 7 / 20 books. */
  progressCurrent?: number;
  progressTarget?: number;
  progressUnit?: string;
  startDate?: ISODate;
  targetDate?: ISODate;
  /** Logical date the goal was marked completed (GOAL-2). */
  completedAt?: ISODate;
  sortOrder: number;
  /** In user order. */
  milestones: Milestone[];
  /** Linked habits (GOAL-5). */
  habitIds: UUID[];
  /** Months this is a "monthly goal" for, `YYYY-MM`, ascending (GOAL-6). */
  months: ISOMonth[];
  tagIds: UUID[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Settings {
  'profile.display_name': string;
  week_start: 'mon' | 'sun';
  /** SET-4: hour (0–6) at which a new logical day begins. */
  day_start_hour: number;
  theme: 'light' | 'dark' | 'system';
  date_format: string;
  'backup.auto_enabled': boolean;
  'backup.keep_count': number;
  'updates.enabled': boolean;
  /** DIST-2: when updates were last checked (ISO timestamp), '' if never. */
  'updates.last_checked': string;
  'onboarding.completed': boolean;
  /** Daily view: group habits by category (DAY-4). */
  'day.group_by_category': boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  'profile.display_name': '',
  week_start: 'mon',
  day_start_hour: 4,
  theme: 'system',
  date_format: 'MMM d, yyyy',
  'backup.auto_enabled': true,
  'backup.keep_count': 7,
  'updates.enabled': true,
  'updates.last_checked': '',
  'onboarding.completed': false,
  'day.group_by_category': false,
};
