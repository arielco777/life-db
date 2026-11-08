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
- Startup: read `MAX(version)` from `schema_migrations`. If migrations are pending, call `db_backup` to `backups/pre-migration-<version>-<ts>.db`, then run each pending migration together with its `schema_migrations` insert in one `db_transaction`.
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
  frequency: { type: 'daily' } | { type: 'weekdays'; days: Weekday[] } | { type: 'times_per_week'; count: number };
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
interface JournalRepository { /* forDate, list(filter, page), get, create, update, remove */ }
interface LifeEventRepository { /* overlapping(from, to), list, get, create, update, remove */ }
interface CategoryRepository { /* list, create, update, archive, remove */ }
interface TagRepository { /* list, search(prefix), getOrCreate(name), rename, merge, remove,
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
| `stats.ts` | Per-type stats: completion %, streaks, avg/min/max/total | ANL-1/2, MON-4 |
| `progress.ts` | Goal progress for each progress mode | GOAL-4 |
| `clock.ts` | `nowUtc()`, `logicalToday(dayStartHour)`, `logicalDateOf(ts, dayStartHour)`. The only place the system clock is read. A `useToday()` hook re-renders when the logical day rolls over | SET-4, NFR-11 |
| `ids.ts` | `newId()` (v7), `naturalId(kind, ...parts)` (v5, app namespace), default-category ID constants | FC-1, FC-5 |
| `format.ts` | Value display (`1h 30m`, `8/10`, `2.5 L`) and duration parsing (`1:30`, `90`, `1h30`) | HAB-2 |
| `tags.ts` | Name normalization | TAG-3 |

Stats are computed in TS from the entries for a range, fetched in **one indexed query per view**. Five years × 30 habits is about 55k rows in total, and a month is under 1k rows, so in-memory aggregation is cheap and easy to test. A SQL `GROUP BY` path can be added later if profiling shows it's needed. Nothing derived is persisted (ANL-5).

## 6. Feature design

### 6.1 Daily view (`/day/:date`)

Data loaded with parallel queries: habits active on the date, entries for the date, events overlapping the date, goals that have linked habits (active status), and journal entries for the date. Week and month target progress needs entries for the enclosing period, so the daily view fetches entries for `[startOfMonth(min(weekStart)), date]`.

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
- **Saving:** `useSetEntry()` does an optimistic TanStack Query update, then calls `entryRepo.set`. On error it rolls back and shows a toast (ENT-5, NFR-1).
- **Keyboard** (DAY-3): one focus order through all inputs. A global key handler ignores keys when focus is in a text field.

### 6.2 Monthly view (`/month/:yyyy-mm`)

Data: `habitRepo.activeOn(month)`, `entryRepo.forRange(monthStart, monthEnd)`, `lifeEventRepo.overlapping(month)`, `goalRepo.forMonth(month)`. The grid is built as a `Map<habitId, Map<date, HabitEntry>>`.

```text
                    AUGUST 2026                 ‹ ›  [This month]
            1  2  3  4  5  6  7  8 … 31 │ Summary
Exercise    ✓  ✓     ✓  ✓        ✓      │ 18/31 58%
Reading     ✓     ✓  ✓                  │ 12h43m · 24m/d
Meditate    ✓  ✓                        │  9/31 29%
Sleep       7  6  8  7  …               │ avg 6.8 h
Coffee      2  3  4  2                  │ avg 2.7 cups
Mood        8  6  7  9                  │ avg 7.2/10
            ✈              ✈            │  ← event markers
─────────────────────────────────────────
MONTHLY GOALS
☐ Read 3 books        1/3
☐ Learn a new recipe
☑ Finish project
```

- Rendered as a CSS grid or `<table>` with a sticky first column and header, scrolling horizontally on narrow widths (NFR-8). At most 31 × ~30 cells, so no virtualization is needed.
- **Cell editing** (MON-3): a boolean click toggles. For other types, Enter or a click opens a popover input, and typing a digit starts editing straight away. Arrow keys / Tab navigate. Escape cancels.
- Cells are memoized per (habitId, date) so editing one cell doesn't re-render the whole grid.
- The day header links to `/day/:date` (MON-5). Columns are classed for today, weekend, unscheduled and has-event (MON-6).
- Neighbouring months are prefetched to make navigation instant (MON-2).

### 6.3 Habits management (`/habits`, `/habits/:id`)

- List with drag-to-reorder, filter by category and archived status, and an "Archive" section.
- Form: name, type (locked once entries exist), unit / rating scale, target, frequency, category, priority, dates, tags, linked goals.
- Detail page: stats for the selected period, a chart, and recent entries (ANL-1/3).

### 6.4 Goals (`/goals`, `/goals/:id`)

- List grouped by status, with progress bars. Filter by category.
- Detail page: description, progress control (by mode), a milestone checklist (drag reorder, inline add), linked habits with their month stats, month assignments (a "Goal for: Aug 2026" multi-picker), and tags.

### 6.5 Journal (`/journal`, `/journal/:id`)

- Reverse-chronological feed grouped by date, with infinite scroll (keyset pagination on `(entry_date, created_at)`). Filters: date range, category, tag.
- Editor: plain `<textarea>` with Markdown preview toggle (no rich-text editor in V1). Autosave debounced to 800 ms, plus on blur and window close (JRN-4). Entry date picker, category, tags.
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
| Backup (EXP-4) | Save dialog → `db_backup(path)`. Default name `life-db-YYYY-MM-DD.lifedb`. The UI states that the file restores only on this device |
| Restore (EXP-5) | Open dialog → `db_restore(path)`: Rust opens the file read-only with the device key, checks `schema_migrations` exists and that its max version ≤ the app's, backs up the current DB to `backups/pre-restore-<ts>.db`, swaps the files, reopens, and the frontend reloads. A file that won't open gives a clear "not a Life DB backup from this device" error |
| Auto backup (EXP-6) | On app start, if the newest automatic backup is older than 24h, run `db_backup` to `backups/auto-YYYY-MM-DD.db` and prune down to `keep_count` |

**Deferred to V1.5:** JSON / CSV / Markdown export and import (EXP-1..3). Planned shapes, kept here so V1 doesn't block them:
- JSON: `{ app: "life-db", format: 1, schemaVersion, exportedAt, categories: [], tags: [], habits: [], habitEntries: [], goals: [], milestones: [], goalHabits: [], goalMonths: [], journalEntries: [], lifeEvents: [], entityTags: [] }`
- CSV long `date,habit,type,value,unit,note` and CSV wide `date,<habit1>,<habit2>…`
- Journal Markdown files with front matter (`date`, `title`, `tags`, `category`)

### 6.10 Distribution (DIST)

- **Signing:** Windows Authenticode certificate, Apple Developer ID plus notarization, and a Tauri updater key pair. All secrets live in CI secrets, never in the repo.
- **Updater:** `tauri-plugin-updater` reads a static `latest.json` (e.g. from GitHub Releases). The frontend shows release notes and asks for consent before installing. The check is off when the user disables it (DIST-2). The CSP `connect-src` allows only the update host (NFR-2).
- **Upgrade safety:** after an update, the first launch runs the migration runner (§4.6), which backs up first. If a migration fails, the app shows a recovery screen with "Open backups folder" and "Report issue" (DIST-3).
- **Logging:** `tauri-plugin-log` writes to the app log dir with rotation. Frontend errors are forwarded through an error boundary plus `window.onerror` (DIST-6).
- **About screen:** app version, schema version, data folder, privacy statement, and a feedback/issue link (DIST-4, DIST-5).

### 6.11 Settings & first run

- First run: if `onboarding.completed` is unset, show a single onboarding screen that suggests habits to tick (SET-1).
- Settings: profile name, week start, theme, date format, backup options, data folder path with an "Open folder" button (EXP-7).

## 7. UI system

- **Navigation:** left sidebar on desktop (Today, Month, Habits, Goals, Journal, Events, Analytics, Search, Settings). Below 768 px it collapses into a bottom tab bar, ready for mobile.
- **Routes:** `/` → redirects to `/day/<logicalToday>` (SET-4). Also `/day/:date`, `/month/:ym`, `/habits[/:id]`, `/goals[/:id]`, `/journal[/:id]`, `/events`, `/analytics`, `/search`, `/settings`.
- **Notebook style:** warm off-white "paper" background in light mode, a subtle grid/dot pattern on the monthly grid, a serif or hand-friendly display face for headings and a clean sans for data, category colors used sparingly. Design tokens live in `src/ui/tokens.css`, with dark theme overrides.
- **Feedback:** brief "check" animations for satisfying completion, a toast for errors, no blocking modals for routine entry (NFR-6). Confirmation dialogs only for deletes, restore and merging tags.
- **Accessibility:** native inputs where possible, `aria-label` on grid cells (`"Exercise, August 3: done"`), visible focus rings, AA contrast (NFR-7).

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
│  ├─ platform/             # PlatformService (dialogs, fs) – tauri impl
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
| Performance | Script using `tests/fixtures/seed.ts` (5y × 30 habits, 3k journal entries) | Time the month/day/search queries against the NFR-1 budgets |
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
5. Where do feedback and issue reports go (GitHub Issues, email, form)? This is needed for DIST-4.
