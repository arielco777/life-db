# Life DB V1.5 — Requirements

> Source: [`life-db-developer-overview.md`](../../life-db-developer-overview.md) (roadmap, §19)
> Builds on: [V1 requirements](../v1/requirements.md)
> Companion docs: [`design.md`](./design.md) · [`tasks.md`](./tasks.md)

## 1. Purpose

V1.5 adds the **local extras that need no server**:

- **Export:** the user's data as files they can read, keep and use elsewhere.
- **Import:** a Life DB export brought back in. Until the cloud exists (V5), this is how data moves to a new computer.
- **App lock:** a PIN or password asked when the app opens.

V1.5 stays local-only, like V1. It adds no network requests, no account and no server.

## 2. Scope

### In scope (V1.5)

| Area | Requirements |
| --- | --- |
| Export | EXP-1 (JSON), EXP-2 (CSV), EXP-3 (journal Markdown), EXP-8 (password-protected JSON) — EXP-1..3 were deferred from V1 |
| Import | IMP-1..7 (Life DB JSON exports only) |
| App lock | LOCK-1..8 |
| Updated V1 requirements | SEC-4, DIST-5 (see §5) |

### Out of scope (V1.5)

| Item | Status |
| --- | --- |
| CSV import (habit history from a spreadsheet) | Not planned: hand-edited spreadsheets carry too much bad data to import safely |
| Markdown journal import (Obsidian, Day One…) | Later, to be decided |
| Auto-lock after idle time or on sleep | Later, to be decided |
| Biometric unlock (Touch ID, Windows Hello) | Later, to be decided |
| Re-encrypting the database when the lock is turned on | Open question (design §9) |
| Cloud sync, accounts, multi-device | V5 |

## 3. Glossary

| Term | Meaning |
| --- | --- |
| **Export file** | A Life DB JSON export (EXP-1): every record, readable by Life DB's import |
| **Protected export** | An export file encrypted with a password the user chooses (EXP-8) |
| **Tombstone** | A deleted record in an export: its ID, dates and the IDs it refers to, with no content, so a merge can carry the deletion over |
| **Replace** | Import mode: the file's data becomes the app's data (IMP-3) |
| **Merge** | Import mode: the file's data is combined with the app's data (IMP-4) |
| **Device key** | The random key that encrypts the database (V1, SEC-2) |
| **Lock secret** | The user's PIN or password for the app lock |
| **Recovery key** | A random code shown once when the lock is turned on. It unlocks the app if the lock secret is forgotten |

## 4. Functional requirements

### 4.1 Export (EXP)

Exports live in Settings → Data, next to backup and restore. Each one opens a save dialog.

**EXP-1 JSON export.** Export all of the user's data to one JSON file that Life DB can import (IMP-1).
- The file SHALL contain every record: categories, tags, habits, habit entries, goals, milestones, goal links (habits and months), journal entries, life events and tag links, with their IDs and timestamps.
- Deleted records SHALL be included as **tombstones**: ID, `updatedAt`, `deletedAt`, and the IDs of the records they belonged to (plus a habit entry's date). Their content (names, text, values, notes) SHALL NOT be in the file.
- The user's preferences (week start, day start hour, theme, date format, display name, group by category) SHALL be included. Settings that describe this device (automatic backups, update checks, first-run state) SHALL NOT.
- The file SHALL state the app, the export format version, the schema version and when it was exported.
- WHEN the export is saved THEN the app SHALL show where it was saved, with *Show in folder*.

**EXP-2 CSV habit export.** Export habit entries for use in a spreadsheet.
- Two layouts: **long** (one row per entry: `date, habit, type, value, unit, note`) and **wide** (one row per date, one column per habit).
- The user can limit the export to a date range, and choose whether archived habits are included.
- Values are written in the habit's own unit: booleans as `1`/`0`, durations in minutes, numbers and ratings as entered.
- The file SHALL open correctly in Excel, LibreOffice and Google Sheets, including names with accents and commas.
- A text cell that starts with `=`, `+`, `-` or `@` SHALL be written so spreadsheets do not run it as a formula.

**EXP-3 Journal Markdown export.** Export the journal as Markdown files.
- One file per entry, in a new folder (`Life DB journal YYYY-MM-DD`) inside the folder the user picks. Existing files are never overwritten.
- Each file has front matter with `date`, `title`, `tags` and `category`, followed by the body.
- File names start with the date, so they sort by date. Entries on the same day get distinct names.
- The user can limit the export to a date range.

**EXP-8 Password-protected JSON export.** The JSON export (EXP-1) MAY be protected with a password.
- The save dialog offers *Protect with a password*. With it on, the user enters the password twice. It must be at least 8 characters.
- A protected export SHALL be unreadable without the password.
- WHEN the user exports without a password THEN the app SHALL warn, before saving, that anyone with the file can read everything in it. The same warning applies to CSV and Markdown exports, which are never encrypted.
- A forgotten export password cannot be recovered. The dialog SHALL say so.

### 4.2 Import (IMP)

**IMP-1 Source.** Import reads Life DB JSON exports (EXP-1), protected or not. Other files SHALL be rejected with a clear message.

**IMP-2 Validation.** Before anything changes, the system SHALL check the whole file. Nothing is imported if any check fails.
- It is a Life DB export, and its format version is one this app reads. A file from a newer app SHALL be rejected with "made by a newer version of Life DB".
- Every record is valid (the same rules the app applies when editing).
- Every reference (an entry's habit, a link's goal, a record's category or tag) points to a record in the file or, for a merge, in the app.
- A protected file asks for its password. A wrong password SHALL say so without revealing anything about the file.

**IMP-3 Replace.** The file's data becomes the app's data.
- Everything currently in the app is removed and replaced by the file's records, including its preferences.
- Meant for moving to a new computer, or starting over from an export.
- The confirmation SHALL say plainly that the current data will be replaced, and that a backup is made first (IMP-5).

**IMP-4 Merge.** The file's data is combined with the app's data.
- A record that exists in only one of them is kept.
- A record that exists in both (same ID) keeps the **most recently edited** version. A tie keeps the app's version.
- A tombstone deletes the app's record if the deletion is more recent than the app's last edit of it. Otherwise the app's record stays.
- A tag or custom category in the file with the same name as a different one in the app is **combined** with the app's, keeping the app's ID, and everything that used the file's version moves to the app's (TAG-4 merge).
- The app's preferences are kept.
- Merging the same file twice SHALL change nothing the second time.

**IMP-5 Safety.** Before writing anything, the system SHALL back up the database (`pre-import`, never pruned, like pre-restore backups). The import SHALL run as a single transaction: if it fails, nothing changes.

**IMP-6 Preview.** After validation and before the user confirms, the system SHALL show what the import will do: how many records of each kind it adds, updates and deletes, and for a merge how many it keeps unchanged because the app's copy is newer.

**IMP-7 Result.** After an import, the system SHALL show what changed and offer *Undo import*, which restores the pre-import backup (EXP-5).

### 4.3 App lock (LOCK)

**LOCK-1 Turn on.** In Settings → Security, the user can turn on the app lock with either a **PIN** (6 or more digits) or a **password** (8 or more characters).
- The secret is entered twice.
- PINs that are trivially guessable (one repeated digit, a straight sequence like `123456`) SHALL be rejected.
- The screen SHALL explain that a password protects much better than a PIN against someone who has a copy of the files.

**LOCK-2 Real protection.** With the lock on, the database key SHALL be stored only encrypted with the lock secret (and separately with the recovery key, LOCK-4). It SHALL be removed from the OS credential store and from the fallback key file. Someone with the app's files and the user's OS account SHALL NOT be able to read the data without the lock secret or the recovery key.

**LOCK-3 Lock screen.** With the lock on, the app SHALL open to a lock screen and SHALL NOT open the database until it is unlocked.
- The lock screen shows nothing from the user's data, not even their display name.
- After 5 wrong attempts in a row, each further attempt SHALL wait longer (up to 5 minutes). The wait survives restarting the app.
- WHEN the right secret is entered THEN the app SHALL open where it normally does (the daily view).

**LOCK-4 Recovery key.** When the lock is turned on, the system SHALL show a recovery key once.
- It is a random code (at least 120 bits) in short groups that are easy to copy by hand.
- The user can copy it or save it to a file, and SHALL confirm they saved it before the lock is turned on.
- The screen SHALL say plainly: **if both the lock secret and the recovery key are lost, the data cannot be recovered** (except from an export made earlier).
- The user can create a new recovery key in Settings → Security, after entering the lock secret. The old one then stops working.

**LOCK-5 Forgotten secret.** The lock screen offers *Forgot your PIN/password?*. Entering the recovery key unlocks the app and asks for a new lock secret straight away.

**LOCK-6 Change or turn off.** In Settings → Security, after entering the current lock secret, the user can change it (and switch between PIN and password) or turn the lock off. Turning it off puts the database key back in the OS credential store (or the fallback key file), as in V1.

**LOCK-7 Lock now.** With the lock on, the user can lock the app at once from the navigation and with `Ctrl/Cmd+Shift+L`. The app closes the database, clears the key from memory and shows the lock screen.

**LOCK-8 Backups stay usable.** Turning the lock on, off, or changing the secret SHALL NOT change the database key. Existing backups (manual and automatic) SHALL keep restoring on this device.

## 5. Changes to V1 requirements

- **SEC-4 Transparent** becomes: *Encryption SHALL need no action from the user in daily use. With the app lock off (the default), the app opens straight to the daily view. With it on, the app opens to the lock screen (LOCK-3).*
- **DIST-5 Privacy statement** gains: *Exports are files you choose to create. Unless you protect a JSON export with a password, anyone with the file can read it.*

## 6. Non-functional requirements

All V1 NFRs still apply. In addition, with the NFR-1 dataset (5 years × 30 habits plus 3,000 journal entries):

- **NFR-12 Export speed.** A full JSON export SHALL finish in under 5 s. CSV and Markdown exports in under 5 s.
- **NFR-13 Import speed.** Validating and previewing an export of that dataset SHALL take under 5 s, and the import itself under 10 s, for both replace and merge. The app shows progress and stays responsive.
- **NFR-14 Round trip.** Exporting, then importing with replace into an empty app SHALL reproduce the same data: every record, ID, timestamp and preference in the export.
- **NFR-15 Unlock time.** Unlocking SHALL take under 1 s on a typical laptop, while deriving the key from the secret is deliberately slow enough to make guessing expensive (design §5).
- **NFR-16 Secrets.** The lock secret, recovery key and export password SHALL never be written to disk, logs or settings. The database key SHALL be cleared from memory when the app locks.
