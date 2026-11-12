# Life DB V1 — Design

> Implements: [`requirements.md`](./requirements.md) · Work breakdown: [`tasks.md`](./tasks.md)

## 1. Overview

Life DB V1 is a Tauri 2 desktop app. The UI is React + TypeScript running in the system webview. All data lives in one SQLite file in the OS app data directory. The UI talks to the database only through a TypeScript **domain/repository layer**. Below that layer is a minimal **SQL driver** interface, implemented in production by a small Rust command layer and in tests by `better-sqlite3`.

```text
┌───────────────────────────────────────────────────────────────┐
│ React UI (routes, components)                                 │
│   └─ hooks: useDay(date), useMonth(ym), useHabits() …         │
│        (TanStack Query: caching, optimistic updates)          │
├───────────────────────────────────────────────────────────────┤
│ Domain layer  src/domain/                                     │
│   types · zod schemas · services (stats, targets, schedule)   │
│   Repository interfaces (HabitRepo, EntryRepo, GoalRepo …)    │
├───────────────────────────────────────────────────────────────┤
│ SQLite repositories  src/data/sqlite/                         │
│   SQL lives ONLY here · migrations · row ↔ domain mapping     │
├───────────────────────────────────────────────────────────────┤
│ SqlDriver interface  { query, execute, transaction }          │
│   ├─ TauriDriver   → invoke('db_*') → Rust (rusqlite)         │
│   └─ NodeDriver    → better-sqlite3 (Vitest only)             │
├───────────────────────────────────────────────────────────────┤
│ life.db  (app data dir, WAL mode, FKs on)                     │
└───────────────────────────────────────────────────────────────┘
```

Platform-specific features (file dialogs, revealing a folder, file writes) sit behind a `PlatformService` interface in `src/platform/`, so a future mobile build only has to swap that implementation (FC-4).

## 2. Tech stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Shell | **Tauri 2** | Desktop now. iOS/Android targets later from the same project. |
| UI | React 19 + TypeScript (strict) + Vite 8 | |
| Routing | React Router | Hash or memory router, as suits Tauri |
| Server-state cache | TanStack Query | Wraps repository calls; optimistic updates for entry edits |
| Validation | Zod | Domain schemas shared by forms and repositories |
| Dates | date-fns | Local-date helpers; no time zone conversion for `YYYY-MM-DD` |
| IDs | UUID v7 (`uuidv7` package) for new records; UUID v5 (`uuid` package) for natural IDs | Time-ordered, sync-friendly (FC-1). Natural IDs per FC-5 (§4.1) |
| Styling | CSS Modules + CSS custom properties (design tokens) | Light/dark themes, notebook style |
| Charts | Lightweight lib (e.g. uPlot or Recharts) | ANL-3 only |
| DB (prod) | Rust `rusqlite` with `bundled-sqlcipher-vendored-openssl` feature | Bundles SQLCipher (SQLite + AES-256) with FTS5. See §3. |
| Key storage | Rust `keyring` crate | OS credential store for the device key (SEC-2) |
| DB (tests) | `better-sqlite3` | Same SQL, unencrypted, run under Vitest in Node. Encryption is tested in Rust (§9). |
| Tests | Vitest (+ React Testing Library for components), Playwright later if needed | |
| Lint/format | ESLint + Prettier, `cargo fmt`/`clippy` | |
| Updates | `tauri-plugin-updater` | Signed update manifests (DIST-2) |
| Logging | `tauri-plugin-log` | Rotating local log file (DIST-6) |
| Release | GitHub Actions + `tauri-action` | Builds signed installers for all three OSes (DIST-1) |

## 3. Database access layer

### 3.1 Why a custom Rust command layer instead of `tauri-plugin-sql`

`tauri-plugin-sql` runs on an sqlx connection pool. Running `BEGIN`…`COMMIT` as separate `execute` calls from JS is not guaranteed to land on the same connection, and that breaks NFR-3, which needs multi-statement transactions. We also want the SQLite Online Backup API, `VACUUM INTO`, and FTS5 guaranteed to be present. A small, self-owned Rust module (~200 lines) gives us all of that and still works on mobile, because rusqlite's bundled SQLite compiles for iOS and Android.

### 3.2 Rust commands (`src-tauri/src/commands.rs` over `src-tauri/core`)

The database and key logic live in a separate crate, `src-tauri/core` (`life_db_core`), which has no Tauri dependency. It can be tested with `cargo test` on any machine and reused by mobile builds. The Tauri app crate only wraps it in IPC commands.

One `rusqlite::Connection` sits behind a `Mutex` in Tauri state. It is opened at startup with:

```sql
PRAGMA key = "x'<64 hex chars>'";   -- device key from keyring, must be the first statement (SEC-1)
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
```

| Command | Signature | Purpose |
| --- | --- | --- |
| `db_query` | `(sql, params[]) → rows[]` | SELECT. Rows returned as JSON objects. |
| `db_execute` | `(sql, params[]) → { changes, lastInsertRowid }` | Single write |
| `db_transaction` | `(statements: {sql, params}[]) → results[]` | Runs all statements in one transaction and rolls back on any error |
| `db_backup` | `(destPath) → ()` | Online Backup API. The copy keeps the device key (EXP-4) |
| `db_restore` | `(srcPath) → ()` | Open with device key → validate → auto-backup current → swap → reopen (EXP-5) |
| `db_info` | `() → { path, schemaVersion, sizeBytes }` | Settings screen (EXP-7) |

Params are JSON values mapped to SQLite types (null, integer, real, text). Booleans are sent as 0/1.

### 3.3 Encryption (SEC)

- **Engine:** SQLCipher 4 defaults (AES-256-CBC, HMAC-SHA512, PBKDF2-HMAC-SHA512). The device key is a raw 256-bit key, so it skips key derivation and opens fast.
- **Device key lifecycle:** at startup, read the key from `keyring` (service `life-db`, account `device-key`).
  - No key and no DB → first run: generate the key with OS randomness, store it, then create the DB.
  - No key but a DB exists → show an error screen explaining the database can't be opened on this device, with "Open data folder" and "Report issue". (Recovery is out of scope for V1.)
  - Keyring unavailable → write the key to `<app data>/key` with `0600` permissions, and set a settings flag that shows a warning (SEC-2).
- **Temporary files:** `PRAGMA temp_store = MEMORY` keeps sort and temp data off disk (SEC-3). WAL and journal files are encrypted by SQLCipher.
- **Logging:** the logger only records error codes, stack traces and entity IDs, never SQL params (SEC-3).
- **V1.5 app lock:** the device key will be wrapped by a key derived from the user's PIN or password (and unlocked with OS biometrics where available). The DB file format does not change.
- **Mobile:** `keyring` doesn't target iOS/Android. Key access sits behind a Rust `KeyStore` trait. On mobile, a small Tauri plugin (Swift → iOS Keychain, Kotlin → Android Keystore) implements it.

### 3.4 `SqlDriver` interface (TypeScript)

```ts
export interface SqlDriver {
  query<T = Row>(sql: string, params?: SqlParam[]): Promise<T[]>;
  execute(sql: string, params?: SqlParam[]): Promise<{ changes: number }>;
  transaction(stmts: { sql: string; params?: SqlParam[] }[]): Promise<void>;
}
```

Repositories build a list of statements and pass the whole list to `transaction()` whenever they write more than one row. Read-then-write logic that has to be atomic (rare in V1) is expressed as a single SQL statement (`INSERT … ON CONFLICT … DO UPDATE`, `UPDATE … WHERE`).

## 4. Data model

### 4.1 Conventions

- **Primary keys:** `id TEXT` holding a UUID, generated in TS:
  - **Random-identity records** (habits, goals, milestones, journal entries, events, tags, custom categories): UUID v7 via `newId()`.
  - **Natural-identity records** (FC-5): UUID v5 via `naturalId(kind, ...parts)` under a fixed app namespace UUID (a constant in `src/domain/ids.ts`, never changed):

    | Table | ID derived from |
    | --- | --- |
    | `habit_entries` | `naturalId('habit_entry', habitId, date)` |
    | `goal_habits` | `naturalId('goal_habit', goalId, habitId)` |
    | `goal_months` | `naturalId('goal_month', goalId, month)` |
    | `entity_tags` | `naturalId('entity_tag', tagId, entityType, entityId)` |
    | default `categories` | fixed constants (one per seeded category) |

    Two devices that log Coffee for Aug 14 produce the **same** row ID, so V1.5 sync resolves it as one record (last `updated_at` wins) instead of two that clash. Tags get random IDs because they can be renamed. V1.5 sync merges tags that share a normalized name, reusing TAG-4 merge.
- **Timestamps:** `created_at`, `updated_at`, `deleted_at` are `TEXT` ISO-8601 UTC (`2026-08-14T09:30:00.000Z`). The repository sets `updated_at` on every write.
- **Calendar dates:** `TEXT 'YYYY-MM-DD'`, local, never converted (NFR-11). Lexical order is the same as chronological order, so range queries use plain string comparison.
- **Soft delete:** every syncable table has `deleted_at`. All reads filter `deleted_at IS NULL`. Uniqueness constraints are partial indexes `WHERE deleted_at IS NULL`.
- **Enums:** `TEXT` with `CHECK` constraints.
- **Booleans:** `INTEGER 0/1`.
- **Link tables** (`goal_habits`, `entity_tags`, `goal_months`) also get their own (natural) `id` and soft delete, so V1.5 can sync them as rows.
- **Re-creating a natural-ID row** (log → clear → log again, unlink → relink) **revives** the soft-deleted row: `INSERT … ON CONFLICT(id) DO UPDATE SET …, deleted_at = NULL, updated_at = ?`. Because a natural-ID row is never duplicated, its uniqueness index is a plain `UNIQUE` (not partial).

### 4.2 ER sketch

```text
categories 1─┬─< habits 1──< habit_entries
             ├─< goals  1──< goal_milestones
             ├─< journal_entries
             └─< life_events

habits >──< goals            (goal_habits)
goals  ──< goal_months       (month goals, 'YYYY-MM')
tags   >──< {habit|goal|journal_entry|life_event}   (entity_tags)
search_index (FTS5) ← triggers on habits, goals, goal_milestones, journal_entries, life_events
settings (key/value)  ·  schema_migrations
```

### 4.3 Schema (migration `0001_init.sql`)

```sql
-- ───────── meta ─────────
CREATE TABLE schema_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TEXT NOT NULL
);

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,            -- JSON-encoded
  updated_at  TEXT NOT NULL
);
-- keys: profile.display_name, week_start, theme, date_format,
--       backup.auto_enabled, backup.keep_count, onboarding.completed

-- ───────── categories & tags ─────────
CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT,                     -- hex or token name
  icon        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_default  INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE UNIQUE INDEX ux_categories_name ON categories(name COLLATE NOCASE)
  WHERE deleted_at IS NULL;

CREATE TABLE tags (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,            -- normalized: trimmed, lowercase (TAG-3)
  color       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE UNIQUE INDEX ux_tags_name ON tags(name) WHERE deleted_at IS NULL;

CREATE TABLE entity_tags (
  id          TEXT PRIMARY KEY,
  tag_id      TEXT NOT NULL REFERENCES tags(id),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('habit','goal','journal_entry','life_event')),
  entity_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE UNIQUE INDEX ux_entity_tags ON entity_tags(tag_id, entity_type, entity_id);
CREATE INDEX ix_entity_tags_entity ON entity_tags(entity_type, entity_id);

-- ───────── habits ─────────
CREATE TABLE habits (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT,
  type             TEXT NOT NULL CHECK (type IN ('boolean','number','duration','rating')),
  unit             TEXT,                       -- number only (HAB-3)
  rating_min       INTEGER,                    -- rating only, default 1
  rating_max       INTEGER,                    -- rating only, default 10
  target_value     REAL,                       -- HAB-4 (NULL = no target)
  target_op        TEXT CHECK (target_op IN ('at_least','at_most')),
  target_period    TEXT CHECK (target_period IN ('day','week','month')),
  frequency_type   TEXT NOT NULL DEFAULT 'daily'
                   CHECK (frequency_type IN ('daily','weekdays','times_per_week')),
  frequency_days   INTEGER,                    -- weekdays bitmask: bit0=Mon … bit6=Sun
  frequency_count  INTEGER,                    -- times_per_week
  frequency_rest   INTEGER NOT NULL DEFAULT 0, -- weekdays: 1 = other days are rest days (HAB-5); migration 0003
  category_id      TEXT REFERENCES categories(id),
  priority         TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  start_date       TEXT NOT NULL,
  end_date         TEXT,
  archived_at      TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT,
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK ((target_value IS NULL) = (target_op IS NULL) AND (target_value IS NULL) = (target_period IS NULL))
);
CREATE INDEX ix_habits_active ON habits(deleted_at, archived_at, sort_order);

CREATE TABLE habit_entries (
  id          TEXT PRIMARY KEY,
  habit_id    TEXT NOT NULL REFERENCES habits(id),
  date        TEXT NOT NULL,                  -- 'YYYY-MM-DD'
  value       REAL NOT NULL,                  -- boolean 0/1 · number · duration minutes · rating int
  note        TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE UNIQUE INDEX ux_habit_entries_day ON habit_entries(habit_id, date);  -- ENT-1; id = naturalId(habit_id, date)
CREATE INDEX ix_habit_entries_date ON habit_entries(date, habit_id);

-- ───────── goals ─────────
CREATE TABLE goals (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  description     TEXT,
  category_id     TEXT REFERENCES categories(id),
  priority        TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('not_started','active','paused','completed','abandoned')),
  progress_mode   TEXT NOT NULL DEFAULT 'milestones'
                  CHECK (progress_mode IN ('milestones','manual','numeric')),
  progress_manual REAL,                       -- 0–100 (manual)
  progress_current REAL,                      -- numeric
  progress_target  REAL,                      -- numeric
  progress_unit    TEXT,                      -- numeric
  start_date      TEXT,
  target_date     TEXT,
  completed_at    TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT
);
CREATE INDEX ix_goals_status ON goals(deleted_at, status);

CREATE TABLE goal_milestones (
  id            TEXT PRIMARY KEY,
  goal_id       TEXT NOT NULL REFERENCES goals(id),
  title         TEXT NOT NULL,
  target_date   TEXT,
  completed_at  TEXT,                         -- NULL = not done
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX ix_goal_milestones_goal ON goal_milestones(goal_id, sort_order);

CREATE TABLE goal_habits (
  id          TEXT PRIMARY KEY,
  goal_id     TEXT NOT NULL REFERENCES goals(id),
  habit_id    TEXT NOT NULL REFERENCES habits(id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE UNIQUE INDEX ux_goal_habits ON goal_habits(goal_id, habit_id);
CREATE INDEX ix_goal_habits_habit ON goal_habits(habit_id);

CREATE TABLE goal_months (                    -- GOAL-6
  id          TEXT PRIMARY KEY,
  goal_id     TEXT NOT NULL REFERENCES goals(id),
  month       TEXT NOT NULL,                  -- 'YYYY-MM'
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE UNIQUE INDEX ux_goal_months ON goal_months(goal_id, month);
CREATE INDEX ix_goal_months_month ON goal_months(month);

-- ───────── journal & events ─────────
CREATE TABLE journal_entries (
  id          TEXT PRIMARY KEY,
  entry_date  TEXT NOT NULL,                  -- JRN-3
  title       TEXT,
  body        TEXT NOT NULL DEFAULT '',
  category_id TEXT REFERENCES categories(id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE INDEX ix_journal_date ON journal_entries(entry_date, created_at);

CREATE TABLE life_events (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  start_date  TEXT NOT NULL,
  end_date    TEXT,                           -- NULL = single day
  category_id TEXT REFERENCES categories(id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX ix_life_events_range ON life_events(start_date, end_date);

-- ───────── search (SRCH) ─────────
CREATE VIRTUAL TABLE search_index USING fts5(
  entity_type UNINDEXED,
  entity_id   UNINDEXED,
  date        UNINDEXED,                      -- entry_date / start_date / NULL
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix   = '2 3'
);
```

**Search index maintenance.** Triggers keep `search_index` up to date, one `AFTER INSERT` / `AFTER UPDATE` / `AFTER DELETE` set per source table. An update deletes the row's index entry and re-inserts it **only if `deleted_at IS NULL`**, so soft-deleted records drop out automatically. Example for journal:

```sql
CREATE TRIGGER trg_journal_ai AFTER INSERT ON journal_entries
WHEN NEW.deleted_at IS NULL BEGIN
  INSERT INTO search_index(entity_type, entity_id, date, title, body)
  VALUES ('journal_entry', NEW.id, NEW.entry_date, COALESCE(NEW.title,''), NEW.body);
END;
CREATE TRIGGER trg_journal_au AFTER UPDATE ON journal_entries BEGIN
  DELETE FROM search_index WHERE entity_type='journal_entry' AND entity_id=OLD.id;
  INSERT INTO search_index(entity_type, entity_id, date, title, body)
  SELECT 'journal_entry', NEW.id, NEW.entry_date, COALESCE(NEW.title,''), NEW.body
  WHERE NEW.deleted_at IS NULL;
END;
```

Mapping per source table: habits → (name, description), goals → (title, description), goal_milestones → (title, '') indexed as `entity_type = 'goal_milestone'` with the milestone's own ID, so each milestone can be re-indexed or removed on its own; the search repository resolves a hit to its goal, life_events → (name, description). Tags are searched with `LIKE` on `tags.name`. A matching tag returns the tag itself plus its tagged records.

### 4.4 Value encoding (habit_entries.value)

| Habit type | Encoding | Display |
| --- | --- | --- |
| boolean | `1` = done (an entry is only stored when done, or `0` if explicitly marked "not done") | ✓ / ✗ / empty |
| number | the number | `2.5 L` |
| duration | integer minutes | `1h 30m` / `90m` |
| rating | integer within `[rating_min, rating_max]` | `8/10` |

"No row" always means **not logged**. A boolean checkbox in the UI toggles between no row and `1`. An explicit "not done" (`0`) is available through a long-press or the context menu, for users who want to tell "didn't" apart from "forgot to log".

### 4.5 Seed data (migration `0002_seed_categories.sql`)

- 8 default categories (CAT-1), each with a color, `is_default = 1` and a **fixed UUID** defined in code, identical on every install (FC-5)
- Settings are **not** seeded. `SettingsRepository` returns `DEFAULT_SETTINGS` (in `src/domain/types.ts`) for any missing or invalid key, so new settings never need a migration. Defaults: `day_start_hour = 4`, `week_start = 'mon'`, `theme = 'system'`, `backup.auto_enabled = true`, `backup.keep_count = 7`, `updates.enabled = true`

### 4.6 Migrations

- Files live at `src/data/sqlite/migrations/NNNN_name.sql` and are bundled with Vite (`import.meta.glob(..., { as: 'raw' })`).
- Startup: read `MAX(version)` from `schema_migrations`. If migrations are pending, call `db_backup` to `backups/pre-migration-<version>-<ts>.db`. Then run **all** pending migrations, with their `schema_migrations` inserts, as one script in one transaction (DIST-3). If any step fails, the database stays at its old version, so the previous app still opens it, and the app shows a recovery screen. Migrations must therefore be transaction-safe: no `PRAGMA foreign_keys`, `VACUUM` or `BEGIN`/`COMMIT`.
- If the DB's version is newer than the app knows about, refuse to open it and show an "update the app" message.
- The test suite runs every migration from scratch against `better-sqlite3`, and checks that the seed data is there.

## 5. Domain layer

### 5.1 Types (excerpt, `src/domain/types.ts`)

```ts
export type ISODate = string;        // 'YYYY-MM-DD'
export type ISOMonth = string;       // 'YYYY-MM'
export type Timestamp = string;      // ISO-8601 UTC
export type UUID = string;

export type HabitType = 'boolean' | 'number' | 'duration' | 'rating';

export interface Habit {
  id: UUID; name: string; description?: string; type: HabitType;
  unit?: string; ratingScale?: { min: number; max: number };
  target?: { value: number; op: 'at_least' | 'at_most'; period: 'day' | 'week' | 'month' };
  frequency: { type: 'daily' } | { type: 'weekdays'; days: Weekday[]; restOnOtherDays?: boolean } | { type: 'times_per_week'; count: number };
  categoryId?: UUID; priority: Priority; startDate: ISODate; endDate?: ISODate;
  archivedAt?: Timestamp; sortOrder: number; tagIds: UUID[];
  createdAt: Timestamp; updatedAt: Timestamp;
}

export interface HabitEntry { id: UUID; habitId: UUID; date: ISODate; value: number; note?: string; }
// Goal, Milestone, JournalEntry, LifeEvent, Category, Tag follow the schema 1:1
```

### 5.2 Repository interfaces (`src/domain/repositories.ts`)

```ts
interface HabitRepository {
  list(opts?: { includeArchived?: boolean }): Promise<Habit[]>;
  activeOn(range: { from: ISODate; to: ISODate }): Promise<Habit[]>;   // MON-8
  get(id: UUID): Promise<Habit | null>;
  create(input: NewHabit): Promise<Habit>;
  update(id: UUID, patch: HabitPatch): Promise<Habit>;                 // enforces HAB-2 type lock
  archive(id: UUID, archived: boolean): Promise<void>;
  remove(id: UUID): Promise<void>;                                      // soft, cascades entries
  reorder(idsInOrder: UUID[]): Promise<void>;
}

interface HabitEntryRepository {
  forRange(from: ISODate, to: ISODate, habitIds?: UUID[]): Promise<HabitEntry[]>;
  set(habitId: UUID, date: ISODate, value: number, note?: string): Promise<HabitEntry>; // upsert on naturalId, revives soft-deleted
  clear(habitId: UUID, date: ISODate): Promise<void>;                                   // soft delete
}

interface GoalRepository { /* list(filter), get, create, update, remove, reorder,
  milestones: add/update/toggle/reorder/remove, linkHabit/unlinkHabit,
  setMonths(goalId, months[]), forMonth(month) */ }
interface JournalRepository { /* forDate, list(filter, page), facets, get, create, update, remove */ }
interface LifeEventRepository { /* overlapping(from, to), list, get, create, update, remove */ }
interface CategoryRepository { /* list, create, update, archive, remove */ }
interface TagRepository { /* list, search(prefix), getOrCreate(name), rename, merge, remove, usageCounts,
  setTags(entityType, entityId, tagIds) */ }
interface SearchRepository { search(q: string, filters?: SearchFilters): Promise<SearchResult[]>; }
interface SettingsRepository { get<K>(key: K): Promise<Settings[K]>; set<K>(key: K, v: Settings[K]): Promise<void>; }
```

All repositories are built once in `createRepositories(driver: SqlDriver)` and handed to React through a `RepositoryProvider` context. Components never import `src/data/**` (an ESLint `no-restricted-imports` rule enforces this, FC-3).

### 5.3 Domain services (pure TS, unit-tested)

| Module | Responsibility | Req |
| --- | --- | --- |
| `dates.ts` | Calendar math on `YYYY-MM-DD` strings in UTC (add/diff days, week and month boundaries by week start), so DST can never shift a date | NFR-11 |
| `schedule.ts` | `isScheduled(habit, date)`, `scheduledDays(habit, range)` and `expectedCompletions()` from frequency + start/end dates. "N times per week" habits: any active day counts; a full week expects N, a partial week (month edges, habit start/end) expects `round(N × activeDays / 7)` | HAB-5 |
| `targets.ts` | `evaluateTarget(habit, values, asOf, weekStart)` → `met` / `not_met` / `in_progress` / `no_data` plus actual and progress, for the day, week or month containing `asOf`. Roll-up: boolean = done days, number/duration = sum, rating = average | HAB-4, DAY-5 |
| `stats.ts` | `computeStats(habit, values, range, { weekStart, today })`: boolean → done / expected / completion + current and longest streak (days, or weeks for N/week); number → total/avg/min/max; duration → total, avg per logged day and per calendar day; rating → avg/min/max. Days after `today` are ignored, and an unlogged today (or unfinished week) doesn't break a streak. `previousPeriod()` for comparisons (August → July) | ANL-1/2, MON-4 |
| `progress.ts` | Goal progress for each progress mode | GOAL-4 |
| `clock.ts` | `nowUtc()`, `logicalToday(dayStartHour)`, `logicalDateOf(ts, dayStartHour)`. The only place the system clock is read. A `useToday()` hook re-renders when the logical day rolls over | SET-4, NFR-11 |
| `ids.ts` | `newId()` (v7), `naturalId(kind, ...parts)` (v5, app namespace), default-category ID constants | FC-1, FC-5 |
| `format.ts` | Value display (`1h 30m`, `8/10`, `2.5 L`; compact `1h30` for grid cells), locale-aware numbers and percentages, and duration parsing (`45`, `0:45`, `1h30`, `1.5h`, `2 hours`) | HAB-2, MON-1 |
| `tags.ts` | Name normalization | TAG-3 |

Stats are computed in TS from the entries for a range, fetched in **one indexed query per view**. Five years × 30 habits is about 55k rows in total, and a month is under 1k rows, so in-memory aggregation is cheap and easy to test. A SQL `GROUP BY` path can be added later if profiling shows it's needed. Nothing derived is persisted (ANL-5).

## 6. Feature design

### 6.1 Daily view (`/day/:date`)

Data loaded with parallel queries (`useDay`): habits active on the date, entries, events overlapping the date (V1.1), goals that have linked habits (V1.1), and journal entries for the date. Week and month targets need the enclosing period, so entries are fetched for `dayWindow(date)`: the union of the date's week and month. Moving between days of the same month reuses that one cached query, and saving a value patches it in place.

```text
┌──────────────────────────────────────────────┐
│  ‹  Thursday, August 14 2026  ›     [Today]  │
├──────────────────────────────────────────────┤
│  ✈ Vacation in Lisbon (Aug 10–17)            │
├──────────────────────────────────────────────┤
│  HABITS                                      │
│  [✓] Exercise          ●●●○ 3/4 this week    │
│  [✓] Read                                    │
│  [ ] Meditate                                │
│  Sleep     [ 7.2 ] h                         │
│  Coffee    [ − 2 + ] cups   ⚠ target ≤2      │
│  Reading   [ 0:45 ]                          │
│  Mood      1 2 3 4 5 6 7 [8] 9 10            │
├──────────────────────────────────────────────┤
│  GOALS                                       │
│  Learn French ▓▓▓░░ 2/5                      │
│     Study French 30m ✓                       │
├──────────────────────────────────────────────┤
│  JOURNAL                                     │
│  ┌──────────────────────────────────────┐    │
│  │ Today was…                           │    │
│  └──────────────────────────────────────┘    │
│  #stress #money                    + entry   │
└──────────────────────────────────────────────┘
```

- **One habits section** (DAY-1): every habit type shares one list in user order, and each row renders its own input. Keep the row component layout-agnostic, because a separate measurements presentation may come in a later UI redesign.
- **Per-type inputs** (`<HabitInput habit value onChange />` dispatches to): `BooleanToggle`, `NumberInput` (stepper and free entry), `DurationInput` (accepts `45`, `0:45`, `1h30`), `RatingPicker` (segmented buttons, number keys).
- **Input behavior:** `BooleanToggle` click toggles *done ↔ not logged*. An explicit *not done* (0, ✗) is set from the entry's `⋯` menu, which also holds the note (ENT-3) and *Clear entry* (ENT-2). Text inputs commit once on Enter or blur, never per keystroke. Escape reverts, and invalid text is flagged and never saved (ENT-4). Rating scales wider than 11 values use a whole-number field instead of buttons.
- **Saving:** `useSetEntry()` does an optimistic TanStack Query update, then calls `entryRepo.set`. On error it rolls back and shows a toast (ENT-5, NFR-1).
- **Keyboard** (DAY-3): one focus order through all inputs. A window key handler maps ←/→ to the previous/next day and `t` to today. It ignores keys typed in text fields, selects and dialogs, keys a widget already handled (`defaultPrevented`, e.g. arrows in a rating) and keys pressed with modifiers.
- **Group by category** (DAY-4): a checkbox in the habits header, stored as the `day.group_by_category` setting so it carries over to other devices once sync exists. Groups follow the category order from Settings, habits keep their own order within a group, and "No category" comes last.
- **Quick journal** (DAY-1 §5): a textarea under the day's entries. Ctrl/⌘+Enter or *Add entry* creates an entry for that date; *Full editor* opens `/journal/new?date=` with title, category, tags and preview.
- **Row status** (DAY-5, HAB-5): under each habit name, "Not scheduled" on off days (still loggable), day targets as met / below / over, week and month targets as progress so far ("3 / 4 this week", "1h 30m / 10h this month", "avg 6.5 this week · target ≥ 7"), and ●●○ dots for N-per-week habits without a target.

### 6.2 Monthly view (`/month/:yyyy-mm`)

Data: `habitRepo.activeOn(month)`, `entryRepo.forRange(monthStart, monthEnd)`, `lifeEventRepo.overlapping(month)`, `goalRepo.forMonth(month)`. The grid is built as a `Map<habitId, Map<date, HabitEntry>>`.

Laid out like a paper habit tracker: days run down the left, habits across the top with their names written at an angle.

```text
  AUGUST 2026                            ‹ ›  [This month]
                 Exer/  Read/  Sleep/  Coffee/  Mood/
                cise   ing           (cups)
  Sat  1          ✓      ✓      7.2      2       8
  Sun  2          ✓             6.5      3       6
  Mon  3 ✈               ✓      8.0      1       7
  …
  Mon 31          ✓      ✓      7.0      2       8
 ─────────────────────────────────────────────────────
  Summary       18/31  12h43   avg 6.8  avg 2.3  avg 7.2
                 58%   24m/d
MONTHLY GOALS
☐ Read 3 books        1/3
☐ Learn a new recipe
☑ Finish project
```

- Rendered as a `<table>`: one row per day, one column per habit. The day column (number, weekday, event marker) and the header row of habit names are sticky. When the habits don't fit the width, the table scrolls horizontally (NFR-8). Most people track fewer than ~15 habits, so a phone in portrait shows the columns and the month scrolls down naturally. At most 31 × ~30 cells, so no virtualization is needed.
- **Column headers:** habit names are written at an angle (about 60°, like the paper tracker) so narrow columns can hold long names. The full name is in a `title` tooltip and the accessible label. The number habit's unit appears under the name.
- **Tint** (MON-6): logged cells get a light tint of the habit's category color (the accent color for habits without a category), mixed with `color-mix()` so it stays light in both themes. Checkboxes fill the cell; number, duration and rating cells show the value on the tint. An explicit "not done" (0) stays untinted with a faint ✗.
- **Cell editing** (MON-3): the table follows the ARIA grid pattern. It is a single Tab stop (Tab enters and leaves it), and ↑/↓ move between days, ←/→ between habits, Home/End to the first/last habit, PgUp/PgDn by a week. A checkbox cell toggles on click, Space or Enter; `1`/`0` set done / not done. Other cells open a small in-cell editor on click, Enter or a typed digit (the digit starts the text). Enter saves and moves down a day, so a column can be filled like a notebook; Tab saves and moves right, Escape cancels, and clicking away saves. A rating cell takes a digit directly (`0` = 10), and Enter opens the 1–N picker. Delete clears a cell. Invalid text is flagged and never saved.
- **Read-only cells** (ENT-2): days after the logical today, and days outside the habit's start/end dates, can be focused but not edited (`aria-disabled`, labelled "not yet" / "outside the habit's dates"). The daily view for a future date shows the habits with disabled inputs and a note.
- **Rest days** (HAB-5): for a weekday habit whose other days are rest days, an empty rest-day cell shows a faint "–" instead of the off-day hatching. Doing the habit anyway is saved and gets a small "!" in the corner of the cell (`rest-broken`), and the summary row adds "⚠ N" for the month. `isRestDay` and `restDaysLogged` in `schedule.ts` are the single source for this.
- Each cell has an accessible label: "Exercise, Monday, August 3: done", plus ", not scheduled" on off days, ", rest day" on rest days, or ", on a rest day" when a rest day was logged (NFR-7).
- Cells are memoized on primitive props (value, scheduled, target status, colour, tab stop, editing), and grid actions come from a stable context, so editing one cell re-renders only that cell and the summary row.
- **Summary row** (MON-4): a sticky footer row under day N with each habit's month summary from `stats.ts`.
- The day number links to `/day/:date` (MON-5). Rows are classed for today and weekend, cells for unscheduled and target-met, and days with life events show a marker next to the number (MON-6).
- Neighbouring months are prefetched to make navigation instant (MON-2).

### 6.3 Habits management (`/habits`, `/habits/:id`)

- List with drag-to-reorder, filter by category and archived status, and an "Archive" section.
- Form: name, type (locked once entries exist), unit / rating scale, target, frequency, category, priority, dates, tags, linked goals.
- Detail page: summary, archive/delete, and the last 7 days with live inputs (V1.0). Stats for the selected period and a chart arrive with analytics (ANL-1/3, V1.1).
- **End date is an explicit choice:** *Ends: (•) Never ( ) On a date*. The date field appears only for "On a date" and is then required, and switching back to Never clears it. The habit page states the window ("From Aug 14, 2026 · no end date", "… · ends in 53 days"). Finished habits get an **Ended** badge and list rows show "Ends/Ended Dec 31", so a habit that leaves the daily view on schedule is never mistaken for an archived or missing one.
- Reordering uses `@dnd-kit` (pointer, touch and keyboard: focus the ⠿ handle, Space, arrows, Space). It is disabled while a category filter is active, since a partial list can't define a full order.
- A rating habit's scale is locked once it has entries, like its type (HAB-2), so existing values can't fall outside the scale.

### 6.4 Goals (`/goals`, `/goals/:id`)

- List grouped by status, with progress bars. Filter by category.
- Detail page: description, progress control (by mode), a milestone checklist (drag reorder, inline add), linked habits with their month stats, month assignments (a "Goal for: Aug 2026" multi-picker), and tags.

### 6.5 Journal (`/journal`, `/journal/:id`)

- Reverse-chronological feed grouped by date, with infinite scroll (keyset pagination on `(entry_date, created_at, id)`, 30 per page, plus a *Load more* button). Each date heading links to its day (JRN-5). Filters: date range, category (including *No category*), tag. They live in the URL (`?from&to&category&tag`), so going back to the feed restores them.
- The filter menus come from `JournalRepository.facets()`, the categories and tags used by any entry. The feed is paginated, so the loaded page can't tell which archived categories are in use (CAT-5). Only tags in use are offered.
- Editor (`/journal/:id`, and `/journal/new?date=` for a new entry): plain `<textarea>` with a Markdown preview toggle (no rich-text editor in V1). Entry date picker, category, tags. There is no Save button.
- **Autosave** (JRN-4, `useJournalDraft`): title and body save after 800 ms without typing and on blur. Date, category and tags save at once. Saves run one at a time, each sending the latest draft. Pending text is also saved when the editor unmounts and before the window closes: `closeGuard.ts` holds Tauri's close request until registered flushers settle (3 s cap, needs `core:window:allow-destroy`). A save indicator says Saving… / Saved / Couldn't save (Retry).
- **New entries** are created by their first save that has a title or text, so opening "New entry" and leaving creates nothing. `new` and `:id` share one route: after the first save the URL is replaced with `/journal/<id>` and the editor keeps its React key, so typing is never interrupted.
- **Edited note:** "Written Aug 14 · edited Aug 16" appears only when an entry was changed on a later local day than it was written. Same-day changes (autosave, typo fixes) don't count.
- **Preview** (react-markdown + remark-gfm, loaded on first use): raw HTML is shown as text. Links render as text with the address in a tooltip, so a click can't navigate the app's window away, and images are named but never fetched (offline, privacy).
- Delete asks for confirmation (JRN-7), then goes to the journal list (replacing the entry in history, so Back never returns to it).
- The daily view lists every entry for the date (title or first line, plus a snippet under a title) linking to the editor; the quick-entry box has a *Full editor* link for that date (JRN-2, DAY-1).
- Body is stored as Markdown text.

### 6.6 Life events (`/events`)

- Chronological list grouped by year, with a quick-add form (name, start, optional end, category, tags).
- Shown as a banner in the daily view and as markers in the monthly view.

### 6.7 Search (`/search`, `Ctrl/Cmd+K` palette)

- The query is turned into an FTS5 MATCH expression: each token is quoted and given a prefix star (`"fren"*`), so user input can't inject FTS syntax.
- `SELECT entity_type, entity_id, date, snippet(search_index, -1, '<mark>', '</mark>', '…', 12), bm25(search_index) FROM search_index WHERE search_index MATCH ? ORDER BY bm25, date DESC LIMIT 50`. Tag `LIKE` matches are merged in.
- Filters (SRCH-4) are applied with a join back to the source table (category, tags, date).
- Results are grouped by type in the UI. Debounced to 150 ms.

### 6.8 Analytics (`/analytics`)

- Period selector (week / month / year / custom) plus per-habit cards: stats from `stats.ts`, the previous period for comparison, and a small chart.
- Goals summary table (ANL-4).

### 6.9 Backup & restore (`/settings/data`)

| Action | Implementation |
| --- | --- |
| Backup (EXP-4) | Save dialog → `db_backup(path)`. Default name `life-db-YYYY-MM-DD.lifedb`; a name typed without an extension gets `.lifedb` (GTK dialogs don't add it). The UI states that the file restores only on this device, then shows where it was saved with a *Show in folder* link |
| Data location (EXP-7) | `db_info` → database path and size, plus *Open folder*, which opens the file manager with `life.db` selected |
| Restore (EXP-5) | Open dialog → confirm → `db_restore(path, maxVersion)`. Rust copies the file to `life.db.restoring` (the user's file is never modified) and validates the copy: it opens with the device key, passes `PRAGMA quick_check`, has `schema_migrations`, and its max version is ≤ the app's. Then it backs up the current DB to `backups/pre-restore-<ms>.lifedb`, closes it, moves it to `life.db.old`, drops any `-wal`/`-shm`, moves the copy into place and reopens. If any step of the swap fails, the old file goes back and is reopened. The frontend then reloads to the daily view, and the usual migration runs if the backup is older. Errors are written for people: "isn't a Life DB backup from this device", "damaged", "made by a newer version" |
| Auto backup (EXP-6) | After startup (in the background, if `backup.auto_enabled`): `db_auto_backup(today, keep_count)` writes `backups/auto-YYYY-MM-DD.lifedb` unless today's exists, then deletes the oldest `auto-*` files beyond `keep_count`. Pre-migration, pre-restore and manual backups are never pruned. `db_info` reports the newest one's date for Settings |
| Security (SEC-2, SEC-4) | Settings → Security explains what's encrypted and where the key is. When the key-file fallback is in use (`db_info.keyFile`), it warns that the file plus the database is enough to read the data |

**Deferred to V1.5:** JSON / CSV / Markdown export and import (EXP-1..3). Planned shapes, kept here so V1 doesn't block them:
- JSON: `{ app: "life-db", format: 1, schemaVersion, exportedAt, categories: [], tags: [], habits: [], habitEntries: [], goals: [], milestones: [], goalHabits: [], goalMonths: [], journalEntries: [], lifeEvents: [], entityTags: [] }`
- CSV long `date,habit,type,value,unit,note` and CSV wide `date,<habit1>,<habit2>…`
- Journal Markdown files with front matter (`date`, `title`, `tags`, `category`)

### 6.10 Distribution (DIST)

- **Signing:** Windows Authenticode certificate, Apple Developer ID plus notarization, and a Tauri updater key pair. All secrets live in CI secrets, never in the repo.
- **Updater** (DIST-2):
  - `tauri-plugin-updater` reads `releases/latest/download/latest.json` from this repo's GitHub Releases. Packages are verified against the minisign public key in `tauri.conf.json`.
  - The check runs from Rust, so the webview's CSP stays local-only (`tests/network.test.ts`). It happens once the app is up, at most once a day (`updates.last_checked`), and only if `updates.enabled`.
  - A found update shows a quiet banner. *See what's new* opens the release notes (Markdown) with *Install and restart* / *Not now*. Pending saves are flushed, the update is downloaded and verified, then the app restarts.
  - Settings → About has the on/off switch and *Check now*.
- **Releases:** pushing a `vX.Y.Z` tag runs `.github/workflows/release.yml`.
  - It checks that the tag matches the version in all four files (`scripts/version.mjs`), then builds with `tauri-action` into a **draft** release, with install notes for unsigned builds.
  - Publishing the draft is what makes it the update. Steps are in `docs/RELEASING.md`.
- **Startup:** `markInteractive()` (in `src/app/startup.ts`) logs `[startup] daily view ready N ms` once the first daily view has data. Background work, today the daily backup, waits for that plus 2 s via `afterInteractive()`, so it never delays the first screen (NFR-1).
- **Upgrade safety:** after an update, the first launch runs the migration runner (§4.6), which backs up first. If a migration fails, the app shows a recovery screen with "Open backups folder" and "Report issue" (DIST-3).
- **Logging:** `tauri-plugin-log` writes `<app log dir>/life-db.log`, rotated at 1 MB, keeping 5 files, at level info (DIST-6).
  - Rust logs startup, the DB status, and backup/restore outcomes, never SQL parameters.
  - The frontend forwards uncaught errors and unhandled rejections (`installErrorLogging`), and screens that fail to render (a per-screen `ErrorBoundary` with *Try again*, *Go to today*, *Report an issue* and *Open log*).
  - `scrub()` removes anything quoted from messages first, because error messages quote values (SEC-3).
- **About screen** (Settings → About): app and data version, the privacy statement, *Report an issue* and *Open log file* (DIST-4, DIST-5).
  - Issues go to GitHub Issues on `arielco777/life-db`, opened in the browser with the versions prefilled and any error scrubbed. The user reviews everything before sending.
  - The opener capability allows only that URL.
- **Boot error screens** (key missing, startup error, failed migration) offer *Report an issue* and *Open log file*. A failed migration also offers *Open backups folder*.

### 6.11 Settings & first run

- First run: if `onboarding.completed` is unset, show a single onboarding screen that suggests habits to tick (SET-1). It asks for an optional name and offers Exercise, Read, Meditate, Sleep, Coffee and Mood. *Start* creates the ticked habits; *Skip* adds nothing. A database that already has habits or journal entries counts as set up, so people who used the app before onboarding existed never see it.
- Settings tabs: **General** (name, week start, day start, theme, date format), Categories, Tags, **Data** (backup, restore, automatic backups, data folder path with an "Open folder" button, EXP-7), and **Security**.
- Date format (SET-2): one of a fixed list of date-fns patterns (`MMM d, yyyy`, `d MMM yyyy`, `yyyy-MM-dd`, `dd/MM/yyyy`, `MM/dd/yyyy`, `dd.MM.yyyy`), each with a yearless short form. It applies to short dates; headings like "Friday, August 14, 2026" keep the written-out form.
- Theme: `system` removes `data-theme` from `<html>` so the OS preference applies; `light`/`dark` set it (`tokens.css` handles both).
- The display name shows under "Life DB" in the sidebar (SET-3).

## 7. UI system

- **Navigation:** left sidebar on desktop (Today, Month, Habits, Goals, Journal, Events, Analytics, Search, Settings). Below 768 px it collapses into a bottom tab bar, ready for mobile.
- **Routes:** `/` → redirects to `/day/<logicalToday>` (SET-4). Also `/day/:date`, `/month/:ym`, `/habits[/:id]`, `/goals[/:id]`, `/journal[/:id]`, `/events`, `/analytics`, `/search`, `/settings`.
- **Notebook style:** warm off-white "paper" background in light mode, a subtle grid/dot pattern on the monthly grid, a serif or hand-friendly display face for headings and a clean sans for data, category colors used sparingly. Design tokens live in `src/ui/tokens.css`, with dark theme overrides.
- **Feedback:** brief "check" animations for satisfying completion, a toast for errors, no blocking modals for routine entry (NFR-6). Confirmation dialogs only for deletes, restore and merging tags.
- **Category pickers and filters:** `<CategorySelect>` offers active categories, plus the record's own archived category labelled "(archived)" (CAT-2). `<CategoryFilter>` offers active categories, then an "Archived" `<optgroup>` built from the `categoryId`s of the records being listed (CAT-5). Users have tens of habits and categories, so collecting them from the loaded records is cheap and needs no extra query.
- **Accessibility:** native inputs where possible, `aria-label` on grid cells (`"Exercise, August 3: done"`), visible focus rings, AA contrast (NFR-7).
  - Checked automatically: `tests/a11y.test.tsx` runs axe on every screen, and `src/ui/tokens.test.ts` checks every text colour at 4.5:1 and control edges and focus rings at 3:1, in both themes. It also checks that the two dark blocks in `tokens.css` match.
  - Quiet `--border` is for cards and grid rules. Inputs, selects and outline buttons use `--control-border` (3:1).

## 8. Project structure

```text
life-db/
├─ src-tauri/
│  ├─ core/                 # life_db_core: db.rs (SQLCipher), keystore.rs, open logic — no Tauri dep
│  ├─ src/lib.rs            # app setup, state, command registration
│  ├─ src/commands.rs       # db_* IPC commands
│  └─ tauri.conf.json
├─ src/
│  ├─ app/                  # App.tsx, router, providers
│  ├─ domain/               # types, zod schemas, repository interfaces, services/*
│  ├─ data/
│  │  ├─ driver.ts          # SqlDriver interface
│  │  ├─ tauriDriver.ts
│  │  └─ sqlite/            # repositories, mappers, migrations/*.sql
│  ├─ platform/             # PlatformService (dialogs, reveal folder, backup, data info) – tauri impl; tests use tests/fakePlatform.ts
│  ├─ features/             # day/, month/, habits/, goals/, journal/, events/,
│  │                        # analytics/, search/, settings/  (components + hooks)
│  ├─ ui/                   # shared components, tokens.css
│  └─ main.tsx
├─ tests/
│  ├─ nodeDriver.ts         # better-sqlite3 SqlDriver
│  └─ fixtures/seed.ts      # multi-year synthetic data generator (NFR-1)
└─ docs/v1/
```

## 9. Testing strategy

| Layer | Tooling | What |
| --- | --- | --- |
| Domain services | Vitest | schedule, targets, stats, progress, format, edge cases (leap years, month boundaries, week start) |
| Repositories | Vitest + NodeDriver (in-memory `:memory:` DB, all migrations applied) | CRUD, soft delete, uniqueness, upsert, cascade, search triggers, tag merge |
| Migrations | Vitest | Fresh DB → latest. Also open a fixture DB from each prior version → latest |
| Components | Vitest + React Testing Library with in-memory repos | HabitInput per type, grid cell editing, keyboard navigation |
| Performance | `npm run test:perf` (`*.perf.test.*`, run alone and one file at a time, also in CI) on `tests/fixtures/seed.ts` (5y × 30 habits, 3k journal entries) | `data.perf`: the month/day/journal queries. `screens.perf`: switching months and days and showing a save, rendered, against the NFR-1 budgets (2× slack on CI runners) |
| Manual / E2E | Run the Tauri dev build | Backup/restore, first run, install & update (Phase 10) |

The Rust `db_*` commands get `cargo test` cases for: transaction rollback, backup/restore validation, the DB being unreadable without the key, backup → restore round trip, a foreign-key file rejected, and FTS5 available under SQLCipher.

## 10. Forward compatibility

| Future need | How V1 prepares for it |
| --- | --- |
| V1.5 export/import | Versioned JSON shape planned in §6.9. JSON is the **portable, device-independent format**: each device's DB is encrypted with its own key, so data moves between devices (desktop ↔ mobile) via JSON export → import, which rebuilds a local DB. The JSON shape equals the domain types, so export/import are repository calls. JSON exports are unencrypted, so show a warning and consider an optional password. |
| Budgeting module (V3) | Same stack (React + TS), so it can become a feature folder (`src/features/money/`) with its own migrations and repositories on the same `SqlDriver` |
| V1.5 sync | Sync sends per-record changes using the same JSON shapes, not whole export files. Natural IDs (FC-5) mean records two devices create for the same thing merge instead of duplicating. UUID v7 PKs, `updated_at` on every write, soft deletes on all tables including link tables, and a repository seam where change tracking can be inserted. A later migration can add `sync_state` / `dirty` columns or a change log. |
| Postgres mirror | Plain types (TEXT, REAL, INTEGER), no SQLite-only data types, and enums as CHECK constraints map cleanly to Postgres |
| Mobile | Tauri 2 mobile targets. `PlatformService` isolates dialogs and the file system. Responsive layout down to 360 px. Mobile uses the **same SQLite + SQLCipher schema, migrations and repositories** as desktop (Tauri 2 runs the same Rust code), so device DBs never differ in format. rusqlite bundled SQLCipher builds for iOS and Android. Key storage goes behind a `KeyStore` trait (§3.3). |
| V1.5 app lock | Wraps the existing device key. No DB re-encryption needed (§3.3). |
| V2 analytics / V4 AI | Clean, typed, time-stamped source data. `search_index` can be complemented by embeddings later. |

## 11. Open questions

1. Should a boolean habit show an explicit "not done" (✗) by default, or keep it hidden behind the context menu (current design)?
2. Should rating scales other than 1–10 (e.g. 1–5) be offered in V1, or should 1–10 be fixed? (The design supports both.)
3. Should the journal get a WYSIWYG Markdown editor later, or stay a plain textarea?
4. Which chart library? Pick at Phase 13 based on bundle size.
5. ~~Where do feedback and issue reports go?~~ **Decided:** GitHub Issues on `arielco777/life-db` (DIST-4).
