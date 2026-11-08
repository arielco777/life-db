# Life DB V1 — Requirements

> Source: [`life-db-developer-overview.md`](../../life-db-developer-overview.md)
> Companion docs: [`design.md`](./design.md) · [`tasks.md`](./tasks.md)

## 1. Purpose

V1 builds **the best digital replacement for the user's physical Life notebook**: the monthly habit grid, the monthly goals list, and the free-form journal pages. It keeps the notebook simple and stores everything as structured, searchable data that the user can back up.

V1 is a **local-only desktop app** (Tauri 2 + React + TypeScript + SQLite). It needs no account and no internet connection.

## 2. Scope

### In scope (V1)

Habits and measurements · Goals and milestones · Journal · Life events · Categories · Tags · Daily view · Monthly view · Basic analytics · Search · Backup and restore · Distribution to end users (installers, updates).

V1 is built **for other users**, not only the author. It must be installable, updatable and safe with real people's data.

### Release split (V1.0 / V1.1)

V1 ships in two releases, so the core notebook reaches users sooner and real use can shape the rest.

| Release | Requirement areas |
| --- | --- |
| **V1.0** — the notebook | Habits (HAB), entries (ENT), categories (CAT), tags (TAG), journal (JRN), daily view (DAY), monthly view (MON), backup & restore (EXP), encryption (SEC), settings (SET), distribution (DIST), all NFRs and FC |
| **V1.1** — the rest of V1 | Goals (GOAL), life events (EVT), analytics (ANL), search (SRCH), plus the parts of other areas that depend on them: the goals and events sections of the daily view (DAY-1), month goals (MON-7), event markers (MON-6), and goals/events in tag views (TAG-5) |

The V1.0 database schema already contains every V1.1 table, so V1.1 is a plain app update with no data migration. The monthly summary column (MON-4) ships in V1.0. The analytics screens ship in V1.1.

### Out of scope (V1)

| Item | Planned for |
| --- | --- |
| Data export (JSON / CSV / Markdown) and import | V1.5 |
| Accounts / authentication | V1.5 |
| Cloud sync, Supabase, multi-device | V1.5 |
| App lock (PIN / password / biometrics on open) | V1.5 |
| Data-loss recovery: recovery key, password-protected backups, restoring on another device | Later (not yet planned) |
| Payments / premium tier | V1.5+ |
| Trends, correlations, life timeline | V2 |
| Money / budgeting module | V3 |
| AI companion, semantic search | V4 |
| Mobile builds (iOS/Android) | Post-V1 (V1 must not block it) |
| Images / file attachments in journal | Post-V1 |
| Reminders / notifications | Post-V1 |

### Forward-compatibility constraints (must hold in V1)

- **FC-1** Every syncable record SHALL have a stable UUID primary key, plus `created_at`, `updated_at` and `deleted_at`.
- **FC-2** Deletes SHALL be soft deletes (set `deleted_at`). Data is permanently removed only through an explicit "purge" action or a restore.
- **FC-3** The UI SHALL access data only through a repository/domain layer and never through SQL directly.
- **FC-4** The UI SHALL NOT depend on desktop-only APIs except behind a platform service interface (file dialogs, file system), so mobile builds stay possible.
- **FC-5** Records that two devices could create independently for the same thing SHALL get the same ID on both devices, so sync can merge them instead of duplicating them:
  - a habit entry's ID is derived from (habit ID, date)
  - link records (goal↔habit, tag↔record, goal↔month) derive their ID from the pair they link
  - the 8 default categories have fixed, built-in IDs
  - tags with the same normalized name are merged on sync (rule recorded for V1.5)

## 3. Glossary

| Term | Meaning |
| --- | --- |
| **Habit** | Definition of something done or measured repeatedly (e.g. "Coffee"). |
| **Habit entry** | One observation of a habit on one calendar date (e.g. Aug 14 → 3 cups). |
| **Measurement** | A habit whose type is number, duration or rating. Same model and same UI section as other habits in V1. A separate presentation may come with a later UI redesign. |
| **Goal** | An intended outcome (e.g. "Learn French"). |
| **Milestone** | A checkpoint within a goal. |
| **Journal entry** | Free-form text tied to an `entry_date`. |
| **Life event** | A significant occurrence on a date or across a date range. |
| **Category** | The life area a record belongs to (Health, Work…). Each record has at most one. |
| **Tag** | Free-form label. A record can have many. |
| **Day** | A local calendar date (`YYYY-MM-DD`), with no time zone conversion. |

## 4. Functional requirements

Acceptance criteria use "WHEN … THEN the system SHALL …".

### 4.1 Habits (HAB)

**HAB-1 Create habit.** The user can create a habit with: name (required), description, type (required), unit, target, frequency, category, priority, start date (defaults to today), optional end date, tags.
- WHEN the user saves a habit without a name or type THEN the system SHALL refuse and show a validation message.
- WHEN a habit is created THEN it SHALL appear in the daily view on each date from its start date onward.

**HAB-2 Habit types.** The system SHALL support four types:

| Type | Stored value | Input | Example |
| --- | --- | --- | --- |
| `boolean` | done / not done | checkbox / toggle | Exercise ✓ |
| `number` | decimal number ≥ 0 | numeric field, optional +/- stepper | Coffee 3 cups, Water 2.5 L |
| `duration` | whole minutes ≥ 0 | `h:mm` or minutes | Reading 45 min |
| `rating` | integer within a scale (default 1–10) | 1–N picker | Mood 8/10 |

- A habit's type SHALL NOT be editable once it has entries. (The user can archive it and create a new habit.)

**HAB-3 Unit.** Number habits have a free-text unit (e.g. "cups", "L", "h"). Duration and rating units are fixed by type.

**HAB-4 Target.** A habit MAY have a target: value + comparison (`at_least` / `at_most`) + period (`day` / `week` / `month`).
- Examples: Exercise at_least 4 per week; Coffee at_most 2 per day; Reading at_least 30 min per day.
- WHEN a target is set THEN the daily and monthly views SHALL indicate whether the target was met.

**HAB-5 Frequency.** A habit has a schedule: `daily` (default), `specific weekdays` (e.g. Mon/Wed/Fri), or `n times per week`.
- WHEN a date is not scheduled for a weekday-based habit THEN the daily view SHALL show the habit as "not scheduled" (it can still be logged), and analytics SHALL leave that date out of completion rates.

**HAB-6 Priority.** Each habit has a priority: `low` / `medium` / `high` (default `medium`). Priority is independent of category.

**HAB-7 Edit habit.** The user can edit every field except as restricted by HAB-2.

**HAB-8 Archive habit.** The user can archive and unarchive a habit.
- Archived habits SHALL NOT appear in the daily view or the current monthly view, but their past entries SHALL stay visible in past months, analytics and search.

**HAB-9 Delete habit.** The user can delete a habit after confirming. Its entries are soft deleted along with it.

**HAB-10 Reorder habits.** The user can set the order habits appear in the daily and monthly views.

### 4.2 Habit entries (ENT)

**ENT-1 One value per habit per day.** There is at most one entry per (habit, date). Logging again overwrites the existing value, and the entry keeps the same ID even after it's cleared and logged again (FC-5).

**ENT-2 Log / edit / clear.** The user can set, change or clear the value for any habit on any date, including past dates.
- Clearing a value SHALL remove the entry. ("No entry" means not logged. It is different from logging 0 or "not done".)

**ENT-3 Optional note.** An entry MAY carry a short text note.

**ENT-4 Validation.** Values SHALL be validated against the habit type (rating inside its scale, duration and number ≥ 0).

**ENT-5 Instant save.** Entry changes SHALL save automatically, with no explicit Save button.

### 4.3 Goals (GOAL)

**GOAL-1 Create goal.** Fields: title (required), description, category, priority, start date, target date, status, tags.

**GOAL-2 Status.** One of `not_started`, `active` (default), `paused`, `completed`, `abandoned`.
- WHEN status becomes `completed` THEN the system SHALL record a `completed_at` date.

**GOAL-3 Milestones.** A goal has an ordered list of milestones. Each has a title, optional target date, and done/not done with a completion date.

**GOAL-4 Progress.** Each goal has a progress mode:
- `milestones` (default): progress = completed milestones / total milestones.
- `manual`: the user sets 0–100%.
- `numeric`: current value / target value with a unit (e.g. 7 / 20 books). The user updates the current value.

**GOAL-5 Linked habits.** A goal can link to zero or more habits, and a habit can link to zero or more goals. Neither requires the other.
- The goal detail SHALL list linked habits with their current-month stats.
- The daily view SHALL show active goals with linked habits and those habits' status for that day.

**GOAL-6 Month goals.** The user can mark a goal as a goal for one or more specific months (the notebook's "Monthly Goals" list). The monthly view shows that month's goals.

**GOAL-7 Edit / delete.** Goals and milestones can be edited, reordered and deleted (soft).

### 4.4 Journal (JRN)

**JRN-1 Create entry.** A journal entry has an `entry_date` (defaults to the date being viewed), an optional title, a body (plain text with Markdown allowed), and tags.

**JRN-2 Multiple per day.** Any number of entries per date, including none.

**JRN-3 Dates.** The system SHALL store `entry_date` separately from `created_at` and `updated_at`. The user can change `entry_date` later.

**JRN-4 Autosave.** Entry text SHALL autosave while typing (debounced) and on blur, and nothing typed is lost on close.

**JRN-5 Browse.** The user can list entries in reverse chronological order, filter by date range, category or tag, and open the day of any entry.

**JRN-6 Category.** An entry MAY have a category.

**JRN-7 Delete.** Entries can be deleted after confirming (soft).

### 4.5 Life events (EVT)

**EVT-1 Create event.** Fields: name (required), description, start date (required), optional end date (for ranges such as a vacation), category, tags.
- WHEN an end date is earlier than the start date THEN the system SHALL refuse.

**EVT-2 Display.** Events SHALL appear in the daily view on every date they cover, and as markers in the monthly view.

**EVT-3 List.** The user can list events chronologically and edit or delete them (soft).

### 4.6 Categories (CAT)

**CAT-1 Defaults.** On first launch the system SHALL create: Health, Work, Money, Learning, Relationships, Home, Personal, Leisure.

**CAT-2 Custom.** The user can create, rename, recolor and archive categories. Archived categories stay on existing records but are not offered for new ones.

**CAT-3 Single category.** Habits, goals, journal entries and life events each have at most one category.

**CAT-4 Uniqueness.** Category names are unique (case-insensitive) among non-deleted categories.

**CAT-5 Archived categories in filters and display.** Wherever records can be filtered by category (habits, journal, goals, analytics, search), the filter SHALL offer every active category, plus each archived category that at least one record in that list still uses. Archived options are listed separately from the active ones, under an "Archived" group. A record whose category is archived still shows it; pickers label it "(archived)" (CAT-2).

### 4.7 Tags (TAG)

**TAG-1 Shared tags.** Tags are shared across habits, goals, journal entries and life events.

**TAG-2 Inline creation.** Typing a new tag name in any tag field SHALL create the tag. Existing tags are offered as autocomplete.

**TAG-3 Normalization.** Tag names are stored trimmed and lowercase, and are unique.

**TAG-4 Manage.** The user can rename, merge and delete tags. Renaming updates every record that has the tag. Merging moves all of one tag's records onto the other.

**TAG-5 Filter.** The user can view every record carrying a given tag.

### 4.8 Daily view (DAY)

**DAY-1 Layout.** For a selected date, the daily view SHALL show, in order:
1. Date header with previous/next/today navigation and a date picker
2. Life events that cover the date
3. Habits: **one section** holding all habit types (boolean, number, duration, rating), each with its type-specific input, in user-defined order
4. Goals with habits linked for that day (GOAL-5)
5. Journal entries for that date, plus a "new entry" box

**DAY-2 Speed.** A user with ~10 habits SHALL be able to log every habit and write a short journal line in under 60 seconds, using keyboard only.

**DAY-3 Keyboard.** Tab/Shift-Tab moves between inputs. Space toggles a boolean. Number keys set a rating. `←`/`→` (outside text fields) changes the day. `t` jumps to today.

**DAY-4 Groupings.** Habits are shown in user-defined order (HAB-10). The user can optionally group them by category.

**DAY-5 Target feedback.** Habits with a target show met / not met for the day (where the target period is a day) or progress so far (week/month).

### 4.9 Monthly view (MON)

**MON-1 Grid.** For a selected month, the system SHALL show a grid: rows = habits active during the month, columns = days 1…N. Each cell shows that habit's value on that day:
- boolean → ✓ or empty
- number → value
- duration → compact (`45m`, `1h30`)
- rating → value

**MON-2 Navigation.** Previous/next month, jump to current month, month picker. Switching months SHALL feel instant (see NFR-1).

**MON-3 Inline edit.** Clicking a cell edits it in place: a boolean toggles, other types open a small input. Arrow keys move between cells.

**MON-4 Summary column.** Each row ends with a summary for the month: boolean → `done/scheduled days` and %, number → average (and total if a unit is set), duration → total and average per day, rating → average.

**MON-5 Day link.** Clicking a day header opens the daily view for that date.

**MON-6 Visual cues.** Today's column, weekends, unscheduled days and days with life events are visually distinguished. Cells that meet the target are styled.

**MON-7 Month goals and notes.** Below the grid, show that month's goals (GOAL-6) with their status and progress.

**MON-8 Archived and ended habits.** Habits that were active during any part of the month appear in that month's grid even if they are archived or ended now.

### 4.10 Basic analytics (ANL)

**ANL-1 Per-habit stats** over a selected period (month default; also week, year, custom range):

| Type | Stats |
| --- | --- |
| boolean | done days / scheduled days, completion %, current streak, longest streak |
| number | average, min, max, total, days logged |
| duration | total (h m), average per logged day, average per calendar day |
| rating | average, min, max, days logged |

**ANL-2 Period comparison.** Show the previous period's value next to each stat (e.g. August 58% vs July 45%).

**ANL-3 Simple chart.** Each habit SHALL have a simple chart over the period (bar/line per day, or per week for year ranges).

**ANL-4 Goal summary.** A list of goals with status, progress and target date, filterable by status and category.

**ANL-5 Derived, not stored.** Stats SHALL be computed from source data, never stored as authoritative values.

### 4.11 Search (SRCH)

**SRCH-1 Global search.** One search box, reachable via `Ctrl/Cmd+K`, searches: journal titles and bodies, habit names and descriptions, goal titles, descriptions and milestones, event names and descriptions, and tag names.

**SRCH-2 Results.** Results are grouped by type, show a snippet with the match highlighted, and open the record (or its day) on click.

**SRCH-3 Ranking.** Matches are case-insensitive and diacritics-insensitive, and match whole words and prefixes (`fren` finds "French"). Journal results are ordered by relevance, then most recent date.

**SRCH-4 Filters.** Search can be narrowed by type, date range, category and tag.

**SRCH-5 Responsiveness.** Results update while typing (debounced, see NFR-1).

### 4.12 Backup & restore (EXP)

> EXP-1 (JSON export), EXP-2 (CSV export) and EXP-3 (journal Markdown export), plus data import, are **deferred to V1.5**. In V1, the user's copy of their data is the `.db` backup file below.

**EXP-4 Database backup.** Save a consistent copy of the SQLite database to a user-chosen location. Backups are encrypted with the device key (SEC-2), so in V1 they can be restored only on the same device and OS account.

**EXP-5 Restore.** Restore from a backup file. The system SHALL validate the file (it opens with the device key, has the Life DB schema, and its version is not newer than the app's), automatically back up the current DB first, then replace it. A file that doesn't open with the device key SHALL be rejected with a clear message.

**EXP-6 Automatic local backups.** The system SHALL keep rolling automatic backups in the app data folder (e.g. one per day, keeping the last 7), configurable in settings. They are encrypted with the device key.

**EXP-7 Data location.** Settings SHALL show where the database file lives and offer to open that folder.

### 4.13 Settings & first run (SET)

**SET-1 First run.** On first launch, create the database, seed categories (CAT-1), and offer a short optional setup listing suggested habits (Exercise, Read, Meditate, Sleep, Coffee, Mood) that the user can tick.

**SET-2 Preferences.** Week start day (Mon/Sun), day start time (SET-4), theme (light/dark/system), date format, automatic backup settings.

**SET-3 Local profile.** A single local profile (display name only). No authentication.

**SET-4 Day starts at.** The user can choose when a new day begins, on the hour from midnight to 6 a.m. (default **4 a.m.**). Before that hour, "today" means the previous calendar date.
- WHEN the day starts at 4 a.m. AND the user opens the app at 01:30 on Aug 15 THEN the daily view SHALL open on **Aug 14**, and a quick journal entry SHALL default to `entry_date = Aug 14`.
- This affects only which date counts as "today" (the default view, the Today button, default dates for new entries, today's highlight in the grid). Stored dates and timestamps are not changed, and the user can still log any date manually.
- Changing the setting SHALL NOT move existing data.

### 4.14 Encryption at rest (SEC)

**SEC-1 Encrypted database.** The database file SHALL be encrypted at rest (SQLCipher, AES-256). Opening `life.db` outside the app SHALL show no readable data.

**SEC-2 Device key.** On first run the system SHALL generate a random 256-bit key and store it in the OS credential store (Windows Credential Manager, macOS Keychain, Linux Secret Service). The key SHALL NOT be stored in plain text next to the database. If no credential store is available (some Linux setups), the system SHALL fall back to a key file readable only by the user, and show a warning in settings.

**SEC-3 No plain-text leaks.** Journal text, habit names and other user content SHALL NOT appear in log files (DIST-6) or in temporary files on disk.

**SEC-4 Transparent.** Encryption SHALL need no action from the user in daily use. With no app lock in V1, the app opens straight to the daily view.

### 4.15 Distribution (DIST)

**DIST-1 Installers.** Signed installers for Windows (MSI/NSIS, code-signed), macOS (DMG, signed and notarized) and Linux (AppImage and .deb).

**DIST-2 Updates.** The app SHALL check for updates (on start, at most once a day, can be turned off in settings), show release notes, and install an update only after the user agrees. Update packages SHALL be signature-verified.

**DIST-3 Safe upgrades.** An update SHALL never lose data. The pre-migration backup (NFR-3) runs automatically, and a failed migration leaves the previous DB usable.

**DIST-4 About & support.** An About screen with app version, schema version, a link to report an issue or send feedback, and the privacy statement.

**DIST-5 Privacy statement.** A short, plain-language statement shipped in the app: all data stays on the device, no telemetry, and the only network request is the optional update check.

**DIST-6 Diagnostics.** Errors are written to a rotating local log file. The user can open it or attach it to a bug report. Nothing is sent automatically.

## 5. Non-functional requirements (NFR)

**NFR-1 Performance.** With a seeded dataset of 5 years × 30 habits plus 3,000 journal entries:
- Monthly grid loads in under 200 ms after navigation.
- Daily view loads in under 150 ms.
- Saving an entry updates the UI optimistically in under 50 ms.
- Search returns results in under 300 ms.
- App cold start to an interactive daily view in under 2 s.

**NFR-2 Offline.** All features SHALL work with no network connection. The only network request the app makes is the optional update check (DIST-2).

**NFR-3 Data integrity.**
- Multi-row writes run inside transactions.
- Foreign keys are enforced.
- Schema changes go only through versioned migrations, which run automatically. A failed migration rolls back and leaves the DB untouched.
- Before running migrations on an existing DB, the system SHALL take a backup.

**NFR-4 Durability.** Committed data SHALL survive an app crash or force quit (SQLite WAL mode).

**NFR-5 Privacy.** Data stays on the device in the user's app data directory, encrypted at rest (SEC-1). No telemetry.

**NFR-6 Usability / notebook feel.** A clean, calm, paper-like visual style. Logging is low-friction, with no modal dialogs for routine entry.

**NFR-7 Accessibility.** All controls are keyboard reachable, with visible focus, labels for assistive technology, and WCAG AA contrast in both themes.

**NFR-8 Responsiveness.** Layouts SHALL adapt down to 360 px width (to prepare for mobile, FC-4). On narrow widths the monthly grid scrolls horizontally with a sticky habit-name column.

**NFR-9 Platforms.** V1 ships for Windows, macOS and Linux desktop.

**NFR-10 Testability.** The domain and repository layers SHALL have automated tests that run without the Tauri runtime.

**NFR-11 Time handling.** Calendar dates are stored as local dates (`YYYY-MM-DD`) and never shifted by time zone. Timestamps (`created_at` etc.) are stored as UTC ISO-8601. "Today" is always the *logical* date from SET-4, never the raw system date.
