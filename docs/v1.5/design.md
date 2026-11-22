# Life DB V1.5 — Design

> Requirements: [`requirements.md`](./requirements.md) · Tasks: [`tasks.md`](./tasks.md)
> Builds on: [V1 design](../v1/design.md). Section references like "V1 §3.3" point there.

## 1. Overview

V1.5 adds three things on top of the V1 architecture, and changes none of its layers:

```text
Settings → Data                         Settings → Security, Lock screen
  Export (JSON/CSV/MD)  Import             App lock
        │                  │                   │
  src/features/transfer/ (UI)            src/features/lock/ (UI)
        │                  │                   │
  TransferRepository (domain interface)        │
  src/data/sqlite/transfer/ (SQL)              │
        │                  │                   │
  SqlDriver ── db_* ───────┤                   │
  PlatformService ── export_* ──────── lock_* commands
                           │                   │
                    src-tauri/core: envelope.rs (password encryption), lock.rs
```

- **No schema migration.** Import writes the existing tables. The lock lives in a file next to the database, because it has to be read before the database can be opened.
- **Text processing in TypeScript, crypto and files in Rust.** TS builds and parses export content through the repositories and Zod. Rust does the password encryption, the lock, and all file writes, so secrets never pass through the webview's storage and the app needs no general file-system plugin.

New Rust dependencies (in `life_db_core`): `argon2`, `aes-gcm`, `zeroize`, `base64`. All are pure Rust and build for mobile.

## 2. JSON export (EXP-1, EXP-8)

### 2.1 Format (format version 1)

The file mirrors the **tables**, one array per table, with columns in camelCase. It does not use the domain types, because the domain types fold link tables into lists (`tagIds`, `months`) and drop the timestamps a merge needs. Mirroring tables keeps the file lossless and makes import plain inserts.

```json
{
  "app": "life-db",
  "format": 1,
  "schemaVersion": 3,
  "appVersion": "1.5.0",
  "exportedAt": "2026-12-01T10:00:00.000Z",
  "settings": { "week_start": "mon", "day_start_hour": 4, "theme": "system", "...": "..." },
  "categories":     [{ "id": "…", "name": "Health", "color": "#…", "icon": null, "sortOrder": 0, "isDefault": true, "archivedAt": null, "createdAt": "…", "updatedAt": "…", "deletedAt": null }],
  "tags":           [ … ],
  "habits":         [ … ],
  "habitEntries":   [ … ],
  "goals":          [ … ],
  "goalMilestones": [ … ],
  "goalHabits":     [ … ],
  "goalMonths":     [ … ],
  "journalEntries": [ … ],
  "lifeEvents":     [ … ],
  "entityTags":     [ … ]
}
```

- **Columns:** every column of the table as of schema version 3, renamed to camelCase (`frequency_rest` → `frequencyRest`). `0/1` columns become booleans.
- **Tombstones:** a row with `deleted_at` set is written as `{ "id", "createdAt", "updatedAt", "deletedAt" }` plus its **reference columns**: foreign keys (`habitId`, `goalId`, `categoryId`, `tagId`, `entityType`/`entityId`) and the parts of a natural ID (`date`, `month`). These contain no user text, and they let a replace insert the tombstone without breaking a foreign key. Names, text, values and notes are never written.
- **Settings:** an allowlist of preferences: `profile.display_name`, `week_start`, `day_start_hour`, `theme`, `date_format`, `day.group_by_category`. Device settings (`backup.*`, `updates.*`, `onboarding.completed`) are left out.
- **Order:** rows sorted by `id` within each table, so two exports of the same data are byte-identical and diff cleanly.
- **Versioning:** `format` changes only when the file's shape changes. A future migration that adds a column bumps it to 2, and the importer upgrades a format-1 file in memory first (a chain of `upgradeFormat1To2`… functions, like migrations).
- **Default name:** `life-db-export-YYYY-MM-DD.json`; protected: `life-db-export-YYYY-MM-DD.lifedb-export`.

### 2.2 Building it

`TransferRepository.exportAll()` (in `src/data/sqlite/transfer/export.ts`) runs one `SELECT *` per table, including deleted rows, maps rows to the format, and returns the object. The UI stringifies it (`JSON.stringify(file, null, 1)`: readable and still compact) and passes it to Rust.

`ExportFile` is defined once as a Zod schema in `src/domain/transfer.ts`. Export output is type-checked against it, and import parses with it, so both sides can't drift apart.

### 2.3 Password protection (`life_db_core::envelope`)

A protected export is a small JSON envelope, so the app can recognise it without a password:

```json
{
  "app": "life-db",
  "protected": 1,
  "kdf": { "alg": "argon2id", "m": 65536, "t": 3, "p": 1, "salt": "<b64, 16 bytes>" },
  "cipher": { "alg": "aes-256-gcm", "nonce": "<b64, 12 bytes>" },
  "data": "<b64 ciphertext of the UTF-8 export JSON>"
}
```

- Key = Argon2id(password NFC-normalised, salt), 32 bytes. Parameters are stored in the file so they can be raised later without breaking old files.
- AES-256-GCM with the envelope's header (everything except `data`) as associated data, so tampering with the parameters fails decryption.
- A wrong password and a damaged file both fail the GCM check. Both are reported as "wrong password or damaged file", which reveals nothing.
- The password and derived key are held in `Zeroizing` buffers and never logged.

### 2.4 Rust commands

| Command | Signature | Purpose |
| --- | --- | --- |
| `export_write` | `(path, text, password?) → ()` | Writes `text` as is, or as a protected envelope. Writes to `path.tmp`, fsyncs, renames |
| `export_read` | `(path, password?) → text` | Reads a plain export, or decrypts a protected one. Errors: `NeedsPassword`, `WrongPassword`, `NotLifeDb`, `TooLarge` (> 512 MB) |
| `export_write_folder` | `(parent, name, files: {name, text}[]) → path` | Creates `parent/name` (adding ` (2)`, ` (3)`… if it exists), writes every file, returns the folder. File names are checked: no separators, no `..` |

`PlatformService` gains matching methods (`writeExport`, `readExport`, `writeFolder`) plus `pickFolder()`, so the UI stays free of Tauri imports (FC-4).

## 3. CSV and Markdown exports (EXP-2, EXP-3)

Both are built in pure TS modules in `src/domain/services/` from repository data, and unit-tested without the app:

- **`csvExport.ts`**: `habitCsv(habits, entries, { layout: 'long' | 'wide' })`.
  - RFC 4180 quoting, `\r\n` line ends, a UTF-8 BOM so Excel detects the encoding.
  - Values come from `formatValueForCsv(habit, value)`: boolean `1/0`, duration minutes, numbers as stored.
  - Text cells (habit names, units, notes) starting with `=`, `+`, `-`, `@`, tab or CR get a leading `'` (the OWASP CSV-injection rule). Numeric value cells are never altered.
  - Wide layout: columns in the habits' sort order. Two habits with the same name get ` (2)` in their header.
  - Data: `habits.list({ includeArchived })` and `entries.forRange(range)`. Without a range, from the first entry to today.
- **`markdownExport.ts`**: `journalFiles(entries, tags, categories) → { name, text }[]`.
  - File name: `YYYY-MM-DD <title or first words>.md`, sanitised for Windows, macOS and Linux (no `<>:"/\|?*`, no trailing dot or space, max 80 characters). A clash within the export gets ` (2)`.
  - Front matter in YAML, values quoted with JSON string rules (valid YAML):

    ```markdown
    ---
    date: "2026-08-14"
    title: "Beach"
    tags: ["travel"]
    category: "Social"
    ---

    Swam in the sea
    ```

The UI hands the result to `export_write` (CSV) or `export_write_folder` (Markdown).

## 4. Import (IMP)

### 4.1 Flow

```text
pick file → export_read (asks for a password if NeedsPassword)
          → parse: ExportFile Zod schema, format upgrade if older       (IMP-1, IMP-2)
          → check references                                             (IMP-2)
          → choose Replace or Merge
          → plan: compare with the app's rows → preview counts            (IMP-6)
          → confirm → db_backup_internal('pre-import')                    (IMP-5)
          → apply: one driver.transaction(statements)                     (IMP-5)
          → result screen with Undo import (restores the backup)          (IMP-7)
          → reload (as after a restore)
```

All steps up to *apply* only read. Cancelling at any point changes nothing.

### 4.2 Validation (IMP-2)

- **Shape:** `ExportFile.safeParse`. Each row reuses the domain's rules (enums, ISO dates, `end ≥ start`, rating bounds, the habit target triple). Errors are summarised for people: "Habit entry 2026-08-14 has an invalid value", plus the count of other problems, never a raw Zod dump.
- **References:** every `habitId`, `goalId`, `categoryId`, `tagId` and `entityTags.entityId` must be in the file, or (for a merge) in the app. A live row may not point to a tombstone. A tombstone whose parent is missing is dropped with a note, not rejected: there's nothing left for it to delete.
- **Natural IDs:** for `habitEntries`, `goalHabits`, `goalMonths`, `entityTags`, the `id` must equal `naturalId(…)` of its fields (V1 §4.1). A mismatch means the file was edited by hand and would break merging later, so it is rejected.
- **Format:** `format > 1` → "made by a newer version of Life DB". `app ≠ "life-db"` → "not a Life DB export".

### 4.3 Replace (IMP-3)

In one transaction:

1. `DELETE FROM` every data table, children first: `entity_tags`, `goal_months`, `goal_habits`, `goal_milestones`, `habit_entries`, `journal_entries`, `life_events`, `goals`, `habits`, `tags`, `categories`. These are hard deletes. The search index empties through the existing delete triggers.
2. `INSERT` every row of the file in the reverse order, tombstones included. Tombstones keep their reference columns (§2.1). Their other required columns get neutral placeholders that pass the table's checks (empty name, `type 'boolean'`, `value 0`, `start_date` = the date of `createdAt`). Soft-deleted rows are never read (V1 §4.1); the placeholders exist only so the deletion can still be merged later.
3. Write the file's preferences to `settings`.

### 4.4 Merge (IMP-4)

**Step 1, tags and custom categories with the same name** (case-insensitive, live rows only, but a different ID):
- The file's ID is remapped to the app's in memory.
- Every reference in the file (`categoryId`, `tagId`) follows the remap.
- Link rows whose natural ID includes the remapped ID (`entityTags`) get their ID recomputed.
- Default categories share fixed IDs, so they never need remapping.

**Step 2, upsert with "newer wins":**

```sql
INSERT INTO habits (id, name, …, updated_at, deleted_at) VALUES (?, ?, …)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, …, updated_at = excluded.updated_at,
                              deleted_at = excluded.deleted_at
WHERE excluded.updated_at > habits.updated_at;
```

- A tie keeps the app's row, as IMP-4 requires.
- Tombstones: `UPDATE t SET deleted_at = ?, updated_at = ? WHERE id = ? AND updated_at < ?`. A tombstone for a row the app doesn't have is skipped: there's nothing to delete, and placeholders aren't inserted in a merge.
- Running the same file again matches nothing, which makes the merge idempotent.

**Step 3, settings:** the app's are kept.

The **plan** (IMP-6) is the same comparison done in TS before writing. One query per table reads `id, updated_at, deleted_at` from the app (about 60k rows for the NFR-1 dataset: tens of ms). Each file row is then classified as *add*, *update*, *delete* or *unchanged*. The preview shows those counts per table, in plain words ("1,204 habit entries added · 12 updated · 3 deleted").

### 4.5 Performance (NFR-13)

`Database::transaction` currently calls `tx.execute`, which re-prepares every statement. It switches to `prepare_cached`, so 60k inserts of a few statement shapes run as fast as SQLite allows (well under 2 s). The statements go in one IPC call (about 15 MB of JSON for the NFR-1 dataset). If a test shows that's slow, rows are batched into multi-row `INSERT`s of 200.

### 4.6 Domain interface

```ts
interface TransferRepository {
  exportAll(): Promise<ExportFile>;
  plan(file: ExportFile, mode: 'replace' | 'merge'): Promise<ImportPlan>; // read-only
  apply(plan: ImportPlan): Promise<void>; // one transaction
}
```

It is implemented in `src/data/sqlite/transfer/` and added to `createRepositories`. It is tested on the Node driver like the other repositories (NFR-10).

## 5. App lock (LOCK)

### 5.1 Key wrapping

V1 keeps the 256-bit device key in the OS credential store (or a key file). With the lock on, it is kept only in `<app data>/lock.json`, encrypted twice: once under the lock secret and once under the recovery key.

```json
{
  "version": 1,
  "kind": "pin",
  "kdf": { "alg": "argon2id", "m": 65536, "t": 3, "p": 1 },
  "secret":   { "salt": "<b64>", "nonce": "<b64>", "wrapped": "<b64: AES-256-GCM(device key)>" },
  "recovery": { "salt": "<b64>", "nonce": "<b64>", "wrapped": "<b64>" }
}
```

- Wrapping key = Argon2id(input, salt), with the same envelope code as §2.3. The associated data is `"life-db lock v1 secret"` or `"… recovery"`, so the two wrapped copies can't be swapped.
- Argon2id at 64 MiB and 3 passes takes about 0.3–0.6 s on a laptop (NFR-15). Its memory cost also makes guessing on a GPU expensive.
- **The database key never changes** (LOCK-8). Turning the lock on, off, or changing the secret only rewraps it. Every backup keeps restoring.
- `kind` lets the lock screen show a numeric keypad or a password field without unlocking anything.
- Failed attempts live in a separate `lock-attempts.json` (`{ failures, retryAfter }`). The file holding the wrapped key is then only rewritten when the user changes something.

### 5.2 Recovery key

- 15 random bytes (120 bits), written in Crockford base32 as 6 groups of 4: `7KQ2-M9XD-4TPA-WC81-HN3E-ZR6V`.
- Input is normalised before use: uppercase, spaces and dashes removed, `O→0`, `I/L→1`. The user can type it however it was written down.
- *Save to file* writes `life-db-recovery-key.txt` with a short explanation, through `export_write`.

### 5.3 State and startup

`AppDb` gets a mutable key: `RwLock<Option<Zeroizing<DeviceKey>>>`. `DbStatus` gains `Locked { kind }`.

```text
startup:
  lock.json exists?  ── yes → status Locked; don't open the DB
        │ no
        ▼
  V1 key resolution (resolve_key) → open DB (unchanged)
```

The frontend's startup (`main.tsx`) reads `db_status` first. `Locked` → render only `<LockScreen>`. No repositories or queries exist yet, so nothing can read data. After a successful unlock, the normal startup runs: migrations, the auto backup, the daily view.

### 5.4 Commands

| Command | Purpose |
| --- | --- |
| `lock_new_recovery_key() → string` | Generates a recovery key and holds it as *pending* in memory. Nothing is written yet |
| `lock_enable(kind, secret)` | Needs a pending recovery key (the user confirmed saving it). Writes `lock.json` (tmp + fsync + rename), checks that both copies unwrap, **then** deletes the key from the OS store and key file (LOCK-2) |
| `lock_unlock(secret)` / `lock_unlock_recovery(key)` | Checks the attempt limit, unwraps, opens the DB, status → Ok. A wrong secret records a failure and returns `{ wrong: true, retryAfterMs }` |
| `lock_change(proof, kind, secret)` | `proof` = current secret or recovery key. Rewraps the `secret` copy |
| `lock_replace_recovery(proof)` | Wraps the pending recovery key, replacing the old one (LOCK-4) |
| `lock_disable(proof)` | Saves the key to the OS store (or key file, as in V1), checks it reads back, **then** deletes `lock.json` |
| `lock_now()` | Closes the DB, zeroises the key, status → Locked. The frontend then reloads the window, which clears all JS state and the query cache |

**Crash safety:**
- Every step that removes a copy of the key happens only after the new copy is written and verified.
- A crash between the two leaves both copies, never neither. At startup `lock.json` wins.
- After the next unlock, any leftover key in the OS store or key file is deleted.

**Attempt limit (LOCK-3):** after 5 failures in a row, `retryAfter = now + min(30 s × 2^(failures−5), 5 min)`. Unlock commands called before `retryAfter` are refused without checking the secret. A correct unlock resets the count. Rust enforces this, so the UI can't bypass it. Someone with a copy of the files can bypass it, which is why the screen recommends a password (§5.6).

### 5.5 UI

- **Lock screen** (`src/features/lock/LockScreen.tsx`): app name and a lock icon, a PIN field (`inputmode="numeric"`, masked) or a password field, *Unlock*, and *Forgot your PIN/password?* for the recovery key. While waiting it shows "Too many attempts. Try again in 1:30". It passes axe and works with the keyboard only (NFR-7).
- **Settings → Security** gains *App lock*. Turning it on is a short flow:
  1. Choose PIN or password, enter it twice.
  2. The recovery key: *Copy*, *Save to file*, and an "I saved my recovery key" checkbox.
  3. Done.

  Once on, the section offers *Change PIN/password*, *New recovery key* and *Turn off*, each asking for the current secret.
- **Recovery unlock:** the user goes straight to "Choose a new PIN or password" (LOCK-5) and can't skip it.
- **Lock now** (LOCK-7): a lock button at the bottom of the navigation, and `Ctrl/Cmd+Shift+L`. Shown only when the lock is on.

### 5.6 What the lock does and doesn't protect against

| Scenario | Protected? |
| --- | --- |
| Someone uses the computer while Life DB is closed or locked | Yes |
| Someone copies the data folder (or it's synced to a cloud drive) | Yes. A PIN can be guessed offline in days with enough effort; a good password can't |
| Another program running as the user while Life DB is unlocked | No (true of any desktop app) |
| Someone copied the device key **before** the lock was turned on | No: the key doesn't change (§9, Q1) |

Settings → Security states this in two short sentences.

## 6. Settings → Data layout

```text
Backup & restore           (V1, unchanged)
Export
  [Export everything (JSON)…]   ☐ Protect with a password
  [Export habits (CSV)…]        Layout: (•) one row per entry ( ) one row per day
                                Dates: All ▾   ☐ Include archived habits
  [Export journal (Markdown)…]  Dates: All ▾
Import
  [Import a Life DB export…]
```

Import opens a dialog that walks through the steps of §4.1: *password* if needed, *Replace or Merge*, then the preview with *Import* or *Cancel*, then the result. Each step is a page of the same dialog, with focus moved to its heading.

## 7. Testing

- **Rust (`cargo test`):**
  - envelope round trip, wrong password, tampered header and ciphertext;
  - lock enable → unlock (secret and recovery) → change → disable, with the key in the OS store at the end;
  - a crash at each step (simulated by stopping after each write) leaves a working state;
  - the attempt limit with an injected clock;
  - `export_write_folder` refuses unsafe names and never overwrites.
- **TS (Node driver):**
  - NFR-14 round trip: seed, export, replace into an empty DB, export again, byte-identical;
  - merge rules one by one: add, newer wins, a tie keeps the app's row, tombstone newer or older, same-name tag and category with link IDs recomputed, idempotent second merge;
  - validation rejects: newer format, broken reference, wrong natural ID, invalid row;
  - CSV quoting, BOM and formula guard;
  - Markdown file names and front matter.
- **Components (jsdom + axe):**
  - export options, the import dialog's steps, the lock screen and the turn-on flow;
  - the lock screen never renders user data.
- **Perf (`npm run test:perf`):** NFR-12 and NFR-13 on the seeded dataset.
- **Upgrade:** like V1.1's `tests/upgrade.test.ts`, V1.5 ships no migration, and a V1.1 database opens and reads unchanged.

## 8. Forward compatibility

| Future need | How V1.5 prepares for it |
| --- | --- |
| V5 cloud sync | The merge rules (newer wins, tombstones, same-name tags) are the ones sync needs. Sync can reuse `plan`/`apply` per batch of changes |
| Markdown journal import (later) | `markdownExport.ts` defines the front matter. An importer can read the same shape back |
| Biometric unlock (later) | A third wrapped copy of the key in `lock.json`, released by the OS after a biometric check |
| Mobile | `lock.json` and the envelope are plain Rust with no desktop dependency. File dialogs stay behind `PlatformService` |

## 9. Open questions

1. **Re-key when the lock is turned on?** `PRAGMA rekey` would make a device key copied before the lock useless. The catch is that existing backups would then need the old key to restore, so they'd have to be re-encrypted or kept with their own key. The current plan doesn't re-key (LOCK-8). Revisit if users ask for it.
2. **Remind users to export?** For example, a gentle note in Settings → Data when the last export is over a month old. It's not in V1.5.
