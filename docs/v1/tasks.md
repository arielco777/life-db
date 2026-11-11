# Life DB V1 — Tasks

> Requirements: [`requirements.md`](./requirements.md) · Design: [`design.md`](./design.md)
>
> Each task lists the requirement IDs it satisfies in brackets. Phases are ordered by dependency. Each one ends with a **✅ Done when** check. Phase 1 is the overview's "first technical milestone".

## Release plan

V1 ships in two releases (see requirements §2, "Release split"). The **full schema** (every table, including goals, events and search) ships in V1.0, so V1.1 needs no data migration. V1.1 adds only repositories and UI.

| Release | Phases | Contents |
| --- | --- | --- |
| **V1.0** — the notebook | 0–10 | Habits & entries, categories & tags, daily view, monthly grid, journal, backup & restore, encryption, settings, installers & updates |
| **V1.1** — the rest of V1 | 11–15 | Goals & milestones, life events, analytics, search. Delivered through the updater. |

---

# V1.0

## Phase 0 — Project scaffold

- [x] 0.1 Create a Tauri 2 + React + TypeScript (strict) + Vite app in the repo root. Add `git init` and a `.gitignore`. [NFR-9]
- [x] 0.2 Add ESLint + Prettier, plus a `no-restricted-imports` rule blocking `src/features/**` and `src/ui/**` from importing `src/data/**`. [FC-3]
- [x] 0.3 Add Vitest + React Testing Library. Add `npm run test`, `lint`, `typecheck`, `tauri dev`, `tauri build`.
- [x] 0.4 Create the folder layout from design §8 (`domain/`, `data/`, `platform/`, `features/`, `ui/`, `tests/`).
- [x] 0.5 Add React Router with placeholder routes and the app shell (sidebar, plus a bottom tab bar below 768 px). V1.1 routes stay hidden behind a feature flag. [NFR-8]
- [x] 0.6 Add design tokens (`tokens.css`) with light/dark themes. Follow the system theme. [NFR-6, NFR-7]

**✅ Done when:** `tauri dev` opens a window with navigation between empty pages, and lint, typecheck and test all pass.

---

## Phase 1 — Schema & data-access layer *(first milestone)*

### 1A. Rust DB layer
- [x] 1.1 Add `rusqlite` (feature `bundled-sqlcipher-vendored-openssl`). Open `life.db` in the app data dir with `PRAGMA key` first, then WAL, foreign keys, `synchronous=NORMAL`, `busy_timeout` and `temp_store=MEMORY`. Confirm FTS5 is available. [NFR-3, NFR-4, NFR-5, SEC-1, SEC-3]
- [x] 1.2 `KeyStore` trait plus a `keyring` implementation, and a `0600` key-file fallback with a warning flag. First-run key generation. [SEC-2]
- [x] 1.3 "Can't open database" error screen for when the key is missing but a DB exists. [SEC-2]
- [x] 1.4 Implement the `db_query`, `db_execute` and `db_transaction` commands, mapping JSON params ↔ SQLite types. [NFR-3]
- [x] 1.5 Implement `db_backup` (Online Backup API, device key) and `db_info`. [EXP-4, EXP-7]
- [x] 1.6 `cargo test`: transaction rolls back on error; backup produces a DB that opens; the DB is unreadable without the key; a file with a different key is rejected.

### 1B. TypeScript driver & migrations
- [x] 1.7 Write the `SqlDriver` interface, `TauriDriver` (invoke), and `tests/nodeDriver.ts` (better-sqlite3). [NFR-10]
- [x] 1.8 Migration runner: bundle `migrations/*.sql`, take a backup before migrating, run each migration in a transaction, refuse a newer DB version. [NFR-3]
- [x] 1.9 `0001_init.sql`: every table, index and CHECK in design §4.3, including the V1.1 tables. [FC-1, FC-2, ENT-1, CAT-4, TAG-3]
- [x] 1.10 FTS5 `search_index` plus triggers for journal_entries, habits, goals, goal_milestones and life_events, respecting `deleted_at`. [SRCH-1]
- [x] 1.11 `0002_seed`: 8 default categories with **fixed UUIDs** (design §4.5), plus default settings including `day_start_hour = 4`. [CAT-1, SET-2, SET-4, FC-5]

### 1C. Domain & repositories
- [x] 1.12 Domain types and Zod schemas for every entity (design §5.1). [FC-1]
- [x] 1.13 ID helpers: `newId()` (UUID v7) and `naturalId(kind, ...parts)` (UUID v5 under the app namespace) for habit entries and link tables. [FC-1, FC-5]
- [x] 1.14 Clock helpers: `nowUtc()`, `logicalToday(dayStartHour)`, `logicalDateOf(timestamp, dayStartHour)`. Nothing else reads the system date. [NFR-11, SET-4]
- [x] 1.15 Repository interfaces (design §5.2).
- [x] 1.16 SQLite repositories for V1.0 entities, with row↔domain mappers, `updated_at` handling, and a soft-delete filter on every read:
  - [x] Category, Tag (incl. `getOrCreate`, `setTags` with natural IDs, rename, merge) [CAT-2..4, TAG-1..4, FC-5]
  - [x] Habit (incl. type lock, `activeOn`, reorder, archive, cascading soft delete) [HAB-1..10, MON-8]
  - [x] HabitEntry (`forRange`, `set` = upsert on natural ID that also revives a soft-deleted row, `clear` = soft delete) [ENT-1..4, FC-5]
  - [x] Journal [JRN-1..7]
  - [x] Settings [SET-2..4]
- [x] 1.17 `createRepositories(driver)` and a `RepositoryProvider` React context. [FC-3]
- [x] 1.18 Repository test suite on the in-memory NodeDriver: CRUD, soft delete hides rows, set → clear → set reuses the same entry ID, the same (habit, date) gives the same ID on two separate DBs, cascade, triggers keep search in sync, tag merge. [NFR-10, FC-5]
- [x] 1.19 `tests/fixtures/seed.ts`: synthetic data generator (5 years × 30 habits, 3,000 journal entries, goals, events). [NFR-1]

> Status: code complete. The encrypted DB opens and migrates in the Tauri app on Linux (verified 2026-11-08). The Debug page (dev builds only) covers the create/list check below.

**✅ Done when:** all migrations apply on a fresh DB in both the Node tests and the Tauri app, the repository tests pass, and a dev-only debug page in the Tauri app can create and list a habit and an entry.

---

## Phase 2 — Domain services

- [x] 2.1 `schedule.ts`: `isScheduled`, `scheduledDays` (daily / weekdays / times-per-week, start/end dates). [HAB-5]
- [x] 2.2 `targets.ts`: evaluate targets per day, week (respecting week start) and month. [HAB-4, DAY-5]
- [x] 2.3 `stats.ts`: completion %, current and longest streak, avg/min/max/total, per-logged-day vs per-calendar-day averages. [MON-4, ANL-1, ANL-5]
- [x] 2.4 `format.ts`: value display plus duration parsing (`45`, `0:45`, `1h30`). [HAB-2]
- [x] 2.5 Unit tests for each, including leap years, month boundaries, Sunday/Monday week starts, and `logicalToday` around the day-start hour (e.g. 01:30 with a 4 a.m. start → yesterday). [NFR-11, SET-4]

**✅ Done when:** the services are fully unit-tested and coverage is ≥ 90%.

---

## Phase 3 — Categories & tags UI

- [x] 3.1 Settings → Categories: list, create, rename, recolor, archive, reorder. [CAT-2, CAT-4]
- [x] 3.2 `<CategorySelect>` component (hides archived categories for new records). [CAT-2, CAT-3]
- [x] 3.3 `<TagInput>`: autocomplete, inline creation, normalization. [TAG-2, TAG-3]
- [x] 3.4 Tags management page: rename, merge (with confirmation), delete. A tag view lists every habit and journal entry carrying the tag (goals and events are added in V1.1). [TAG-4, TAG-5]

**✅ Done when:** categories and tags can be fully managed, and the TagInput is reusable by later phases.

---

## Phase 4 — Habits management & entry inputs

- [x] 4.1 Habits list: drag reorder, category filter, archived section. [HAB-8, HAB-10, CAT-5]
- [x] 4.1a Shared `<CategoryFilter>`: active categories, then an "Archived" group with only the archived categories the listed records use. Reused by 7.1, 11.3, 13.5 and 14.3. [CAT-5]
- [x] 4.2 Habit form: all fields, with a type-specific section (unit / rating scale), target, frequency, tags, and type locked when entries exist. [HAB-1..7]
- [x] 4.3 Archive/unarchive and delete with confirmation. [HAB-8, HAB-9]
- [x] 4.4 `<HabitInput>` dispatcher plus `BooleanToggle`, `NumberInput`, `DurationInput` and `RatingPicker`, with validation. [HAB-2, ENT-4]
- [x] 4.5 `useSetEntry` / `useClearEntry` hooks: optimistic update, rollback, error toast. [ENT-2, ENT-5, NFR-1]
- [x] 4.6 Entry note support (popover). [ENT-3]
- [x] 4.7 Component tests for each input type.

**✅ Done when:** habits of all four types can be created, edited, archived and deleted, and the inputs work on their own.

---

## Phase 5 — Daily view

- [x] 5.1 `/day/:date` route, date header with prev/next/today/date picker. `/` and "Today" go to `logicalToday()`. [DAY-1, SET-4]
- [x] 5.2 `useDay(date)` hook: parallel queries for habits, entries (enclosing period) and journal entries.
- [x] 5.3 Sections: one habits section (all types together), then journal. Leave slots for the V1.1 events banner and goals section. [DAY-1]
- [x] 5.4 Target / week-progress indicators. "Not scheduled" state. [DAY-5, HAB-5]
- [x] 5.5 Optional group-by-category toggle. [DAY-4]
- [x] 5.6 Keyboard: focus order, space toggles, number keys for ratings, ←/→ change the day, `t` for today. [DAY-3, NFR-7]
- [x] 5.7 Inline quick journal entry, wired up properly in Phase 7. [DAY-1]

**✅ Done when:** a timed run with 10 habits plus one journal line, keyboard only, takes < 60 s (DAY-2), and the daily view loads in < 150 ms on seeded data (NFR-1).

---

## Phase 6 — Monthly view

- [x] 6.1 `/month/:ym` route with prev/next/this-month and a month picker. Prefetch neighbouring months. [MON-2]
- [x] 6.2 `useMonth(ym)`: habits active during the month and entries for the month. [MON-1, MON-8]
- [x] 6.3 Grid laid out like a paper tracker: days as rows, habits as columns with angled names; sticky day column and header row, horizontal scroll when habits don't fit, per-type cell rendering with category-color tint. [MON-1, MON-6, NFR-8]
- [x] 6.4 Cell editing: boolean click toggles, popover input for other types, ↑/↓ days and ←/→/Tab habits, digit keys start editing. [MON-3]
- [x] 6.5 Summary footer row using `stats.ts`. [MON-4]
- [x] 6.6 Day number → daily view link. Styling for today's row (logical), weekends, unscheduled and target-met cells. [MON-5, MON-6]
- [x] 6.7 Memoized cells and an a11y label for each cell. [NFR-1, NFR-7]
- [x] 6.8 Rest days: weekday habits choose "Other days: optional / rest days" (migration 0003). Rest days are labelled in the daily view and the grid; doing the habit on one is saved but flagged, and counted in the month summary. [HAB-5]

**✅ Done when:** the grid looks and works like the notebook page, and month navigation renders in < 200 ms on seeded data (NFR-1).

---

## Phase 7 — Journal

- [x] 7.1 Journal feed: grouped by date, keyset pagination, filters for date range, category and tag. [JRN-5, CAT-5]
- [x] 7.2 Editor: textarea + Markdown preview, title, entry-date picker (defaults to the viewed date, or `logicalToday()`), category, tags. [JRN-1, JRN-3, JRN-6, SET-4]
- [x] 7.3 Autosave (800 ms debounce, on blur, and on window close). [JRN-4]
- [x] 7.4 Multiple entries per day in the daily view. Wire up quick entry. [JRN-2, DAY-1]
- [x] 7.5 Delete with confirmation. [JRN-7]

**✅ Done when:** nothing typed is lost on a forced close, and an entry's date can be changed later.

---

## Phase 8 — Backup & restore

> JSON / CSV / Markdown export and import (EXP-1..3) are deferred to V1.5.

- [x] 8.1 `PlatformService` (Tauri impl): save/open dialogs, reveal folder. [FC-4]
- [x] 8.2 Manual backup through the save dialog, with a note that it restores only on this device. [EXP-4]
- [x] 8.3 Rust `db_restore`: open with device key, validate, back up the current DB, swap, reopen. The frontend reloads afterwards. [EXP-5]
- [x] 8.4 Settings → Security: key-file fallback warning, plain explanation of what's encrypted. [SEC-2, SEC-4]
- [x] 8.5 Automatic daily backups with pruning to `keep_count`, configurable in settings. [EXP-6]
- [x] 8.6 Data folder path plus an "Open folder" button in settings. [EXP-7]

**✅ Done when:** a backup restores on the same device with identical data, and a newer-version or invalid file is rejected safely.

---

## Phase 9 — Settings, first run & polish

- [x] 9.1 First-run onboarding with suggested habits. [SET-1]
- [x] 9.2 Settings: profile name, week start, **day starts at** (midnight–6 a.m., default 4 a.m.), theme, date format. [SET-2, SET-3, SET-4]
- [x] 9.3 Empty states for every view. Completion animations. Toasts. [NFR-6]
- [x] 9.4 Accessibility pass: keyboard reachability, focus rings, labels, contrast check in both themes. [NFR-7]
- [x] 9.5 Responsive pass down to 360 px. [NFR-8]
- [x] 9.6 Performance pass against the NFR-1 budgets for V1.0 views with the seed fixture, including cold start < 2 s. [NFR-1] *(Cold start: `[startup]` console line, timed by hand in a release build.)*
- [x] 9.7 Confirm the only network request is the update check (CSP `connect-src` in `tauri.conf.json`). [NFR-2, NFR-5]

**✅ Done when:** a full month can be used daily as a replacement for the paper notebook's habit grid and journal pages.

---

## Phase 10 — Distribution & V1.0 release

- [ ] 10.1 Get signing credentials: Windows code-signing cert, Apple Developer ID plus notarization, Tauri updater key pair. Store them as CI secrets. [DIST-1]
- [ ] 10.2 GitHub Actions release workflow with `tauri-action`: signed installers for Windows, macOS and Linux. [DIST-1, NFR-9]
- [ ] 10.3 `tauri-plugin-updater`: daily check, release-notes dialog, install with consent, setting to turn it off. [DIST-2]
- [ ] 10.4 Upgrade test: install release N, add data, update to N+1 with a new migration, verify the data and the pre-migration backup. Simulate a failed migration and show the recovery screen. [DIST-3, NFR-3]
- [ ] 10.5 About screen: versions, privacy statement, feedback/issue link (design §11 Q5). [DIST-4, DIST-5]
- [ ] 10.6 `tauri-plugin-log` with rotation, error boundary and `window.onerror` forwarding, "Open log" in About. Check that logs contain no user content. [DIST-6, SEC-3]
- [ ] 10.7 Clean-machine install test on each OS (no dev tools installed).
- [ ] 10.8 Tag and publish **V1.0**.

**✅ Done when:** a new user can download, install, use and update the app on all three OSes without warnings or data loss.

---

# V1.1

## Phase 11 — Goals

- [ ] 11.1 Goal repository (+ milestones, goal_habits and goal_months with natural IDs) and tests. [GOAL-1..7, FC-5]
- [ ] 11.2 `progress.ts`: milestones, manual and numeric modes, with unit tests. [GOAL-4]
- [ ] 11.3 Goals list grouped by status, with progress bars and a category filter. [GOAL-1, GOAL-2, CAT-5]
- [ ] 11.4 Goal form and detail page: fields, status (sets `completed_at`), progress mode controls. [GOAL-1, GOAL-2, GOAL-4]
- [ ] 11.5 Milestones: inline add, toggle, edit, drag reorder, delete. [GOAL-3, GOAL-7]
- [ ] 11.6 Link/unlink habits, with linked habit month stats on the detail page. [GOAL-5]
- [ ] 11.7 Month assignment multi-picker, the month goals list below the monthly grid, and "Add monthly goal" from the monthly view. [GOAL-6, MON-7]
- [ ] 11.8 Daily view goals section (goals with linked habits and their status for the day). [DAY-1, GOAL-5]
- [ ] 11.9 Tags on goals. Goals appear in the tag view. [TAG-1, TAG-5]

**✅ Done when:** "Learn French" from the overview can be modelled end to end (milestones and linked habits) and shows up in the daily and monthly views.

---

## Phase 12 — Life events

- [ ] 12.1 LifeEvent repository (`overlapping`) and tests. [EVT-1..3]
- [ ] 12.2 Events list grouped by year, with a quick-add form, edit and delete. [EVT-1, EVT-3]
- [ ] 12.3 Validation (end ≥ start), category, tags. Events appear in the tag view. [EVT-1, TAG-1, TAG-5]
- [ ] 12.4 Daily view events banner across the range, and has-event markers in the monthly grid. [EVT-2, DAY-1, MON-6]

**✅ Done when:** a multi-day vacation shows on every covered day and in the month grid.

---

## Phase 13 — Analytics

- [ ] 13.1 `/analytics` period selector (week, month, year, custom). [ANL-1]
- [ ] 13.2 Per-habit stat cards with previous-period comparison. [ANL-1, ANL-2]
- [ ] 13.3 Choose a chart library (design §11 Q4). Per-habit chart, aggregated by week for year ranges. [ANL-3]
- [ ] 13.4 Habit detail page reuses the stat cards and chart. [ANL-1]
- [ ] 13.5 Goals summary table with status and category filters. [ANL-4, CAT-5]

**✅ Done when:** the overview's examples (Exercise 18/31 58% vs July, Sleep avg/min/max, Reading totals) display correctly from the seeded data.

---

## Phase 14 — Search

- [ ] 14.1 Turn user input into a safe FTS5 query (quoted tokens with prefix stars). [SRCH-3]
- [ ] 14.2 Search repository: FTS `bm25` + snippet, merged with tag `LIKE` matches, and tests. [SRCH-1, SRCH-2]
- [ ] 14.3 Filters by type, date range, category and tag. [SRCH-4, CAT-5]
- [ ] 14.4 `Ctrl/Cmd+K` palette and a `/search` page with grouped, highlighted results that link to records. [SRCH-1, SRCH-2]
- [ ] 14.5 150 ms debounce. Verify < 300 ms on seeded data. [SRCH-5, NFR-1]

**✅ Done when:** searching "French" returns the goal, the habit and the journal entries, as in the overview example.

---

## Phase 15 — V1.1 release

- [ ] 15.1 Remove the V1.1 feature flag. Run the performance pass again for the new views. [NFR-1]
- [ ] 15.2 Upgrade test: a V1.0 install with real-looking data updates to V1.1 with no data change. [DIST-3]
- [ ] 15.3 Tag and publish **V1.1** through the updater.

**✅ Done when:** every V1 requirement ID has been checked off.

---

## Requirement coverage

| Area | Requirements | Release | Phases |
| --- | --- | --- | --- |
| Forward compat | FC-1..5 | V1.0 | 0, 1, 8, 11 |
| Habits | HAB-1..10 | V1.0 | 1, 2, 4, 5 |
| Entries | ENT-1..5 | V1.0 | 1, 4 |
| Categories | CAT-1..5 | V1.0 | 1, 3, 4, 7 (filters also in 11, 13, 14) |
| Tags | TAG-1..5 | V1.0 (+ goals/events in V1.1) | 1, 3, 11, 12 |
| Journal | JRN-1..7 | V1.0 | 1, 7 |
| Daily view | DAY-1..5 | V1.0 (+ goals/events sections in V1.1) | 5, 7, 11, 12 |
| Monthly view | MON-1..8 | V1.0 (MON-7 and event markers in V1.1) | 6, 11, 12 |
| Backup/restore | EXP-4..7 (EXP-1..3 → V1.5) | V1.0 | 1, 8 |
| Encryption | SEC-1..4 | V1.0 | 1, 8, 10 |
| Settings | SET-1..4 | V1.0 | 1, 2, 9 |
| Distribution | DIST-1..6 | V1.0 | 10, 15 |
| Goals | GOAL-1..7 | V1.1 | 11 |
| Life events | EVT-1..3 | V1.1 | 12 |
| Analytics | ANL-1..5 | V1.1 (MON-4 summary uses `stats.ts` in V1.0) | 2, 13 |
| Search | SRCH-1..5 | V1.1 (index built from V1.0) | 1, 14 |
| Non-functional | NFR-1..11 | both | throughout, verified in 9, 10, 15 |
