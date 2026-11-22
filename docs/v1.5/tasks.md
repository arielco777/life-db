# Life DB V1.5 — Tasks

> Requirements: [`requirements.md`](./requirements.md) · Design: [`design.md`](./design.md)
>
> Each task lists the requirement IDs it satisfies in brackets. Phases continue V1's numbering and are ordered by dependency. Each one ends with a **✅ Done when** check.

## Release plan

V1.5 ships as **app version 1.5.0** through the updater. It has no data migration. If the app lock takes longer than export and import, phases 16–17 can ship first as 1.5.0 and the lock follows as 1.6.0.

| Phases | Contents |
| --- | --- |
| 16 | Export: JSON (optionally password-protected), CSV, journal Markdown |
| 17 | Import: Life DB JSON, replace or merge |
| 18 | App lock with recovery key |
| 19 | Release |

---

## Phase 16 — Export

### 16A. Format & Rust

- [ ] 16.1 `ExportFile` Zod schema in `src/domain/transfer.ts`: header, preference allowlist, one row schema per table (camelCase columns, booleans), and tombstone schemas with reference columns. Reuse the domain enums and date schemas. [EXP-1]
- [ ] 16.2 `TransferRepository.exportAll()` in `src/data/sqlite/transfer/export.ts`: one query per table including deleted rows, rows sorted by ID, tombstones stripped to their reference columns. Add it to `createRepositories`. [EXP-1]
- [ ] 16.3 `life_db_core::envelope`: Argon2id + AES-256-GCM with the header as associated data, `Zeroizing` secrets. `cargo test`: round trip, wrong password, tampered header and ciphertext. Adds `argon2`, `aes-gcm`, `zeroize`, `base64`. [EXP-8, NFR-16]
- [ ] 16.4 Commands `export_write` (atomic: tmp + fsync + rename), `export_read` (plain or protected, typed errors), `export_write_folder` (safe names, never overwrites). Matching `PlatformService` methods plus `pickFolder()`, with fakes for tests. [EXP-1..3, EXP-8, FC-4]

### 16B. CSV & Markdown

- [ ] 16.5 `csvExport.ts`: long and wide layouts, RFC 4180 quoting, BOM, CSV-injection guard on text cells only, values in each habit's unit, duplicate habit names disambiguated. Unit tests. [EXP-2]
- [ ] 16.6 `markdownExport.ts`: one file per entry, portable file names with clash suffixes, JSON-quoted YAML front matter (date, title, tags, category). Unit tests. [EXP-3]

### 16C. UI

- [ ] 16.7 Settings → Data → *Export*: three actions with their options (password and confirm for JSON; layout, dates and archived for CSV; dates for Markdown), the unencrypted warning, the "can't be recovered" note for passwords, the saved path with *Show in folder*. Component tests and axe. [EXP-1..3, EXP-8]
- [ ] 16.8 Update the privacy statement on the About page. [DIST-5]
- [ ] 16.9 Perf test: each export of the seeded NFR-1 dataset under 5 s. [NFR-12]

**✅ Done when:** all three exports open correctly in their target apps (a JSON viewer, Excel/LibreOffice, a Markdown editor); a protected export can't be read without its password; export times are within NFR-12.

---

## Phase 17 — Import

- [ ] 17.1 Parse and validate: `export_read` with a password prompt, `ExportFile` parsing, format check, reference check (dropping orphaned tombstones), natural-ID check. Errors summarised for people. [IMP-1, IMP-2]
- [ ] 17.2 `Database::transaction` uses `prepare_cached`; measure 60k inserts in one call. Batch into multi-row inserts only if needed. [NFR-13]
- [ ] 17.3 `TransferRepository.plan(file, mode)`: compares with the app's `id, updated_at, deleted_at` per table and counts add, update, delete and unchanged. For a merge, remaps same-name tags and custom categories first and recomputes affected natural IDs. [IMP-4, IMP-6]
- [ ] 17.4 `TransferRepository.apply(plan)` for **replace**: hard-deletes children first, inserts parents first with tombstone placeholders, writes preferences. All in one transaction. [IMP-3, IMP-5]
- [ ] 17.5 `apply` for **merge**: upserts with `WHERE excluded.updated_at > t.updated_at`, applies tombstones only when newer, keeps the app's settings. All in one transaction. [IMP-4, IMP-5]
- [ ] 17.6 Repository tests:
  - the NFR-14 round trip (export → replace into an empty DB → export is byte-identical);
  - each merge rule: add, newer wins, a tie keeps the app's row, tombstone newer and older, same-name tag and category merge;
  - merging a second time changes nothing;
  - a failure partway leaves the DB unchanged;
  - search finds imported records.
  [IMP-2..5, NFR-14]
- [ ] 17.7 Import dialog in Settings → Data: file → password → Replace or Merge → preview → `pre-import` backup and apply → result with *Undo import* (restores the backup) → reload. Focus moves to each step's heading. Component tests and axe. [IMP-3..7]
- [ ] 17.8 Perf test: validate and preview under 5 s, replace and merge each under 10 s on the seeded dataset. [NFR-13]

**✅ Done when:** an export from one computer, imported with replace on a fresh install of another, shows the same data; merging two diverged copies gives the newest version of each record with no duplicate tags or categories; *Undo import* brings back the previous data.

---

## Phase 18 — App lock

### 18A. Rust

- [ ] 18.1 `life_db_core::lock`: the `lock.json` format, wrap/unwrap with the envelope code (separate associated data for the secret and recovery copies), recovery key generation and normalisation (Crockford base32, 120 bits). [LOCK-2, LOCK-4]
- [ ] 18.2 `AppDb` with a mutable, zeroised key; `DbStatus::Locked { kind }`; startup checks `lock.json` before V1 key resolution and deletes leftover keys after an unlock. [LOCK-2, LOCK-3, NFR-16]
- [ ] 18.3 Commands `lock_new_recovery_key`, `lock_enable`, `lock_unlock`, `lock_unlock_recovery`, `lock_change`, `lock_replace_recovery`, `lock_disable`, `lock_now`. Each removes a key copy only after the new one is written and verified. [LOCK-1..8]
- [ ] 18.4 Attempt limit in `lock-attempts.json` (5 free tries, then 30 s doubling to 5 min), enforced in Rust. [LOCK-3]
- [ ] 18.5 `cargo test`:
  - the full lifecycle: enable → unlock with the secret and with the recovery key → change → new recovery key (the old one fails) → disable;
  - a crash at each step leaves a working state;
  - the attempt limit with an injected clock;
  - existing backups still restore after enable and disable;
  - Argon2id time measured under NFR-15.
  [LOCK-1..8, NFR-15]

### 18B. UI

- [ ] 18.6 Startup: `main.tsx` checks `db_status` first and renders only `LockScreen` when locked; after unlock, the normal startup runs. [LOCK-3]
- [ ] 18.7 `LockScreen`: PIN keypad field or password field by `kind`, wait countdown, *Forgot?* → recovery key → mandatory new secret. Shows no user data. Component tests and axe. [LOCK-3, LOCK-5, NFR-7]
- [ ] 18.8 Settings → Security → *App lock*: turn-on flow (PIN or password twice with weak-PIN rejection, the recovery key with copy, save and confirm), *Change*, *New recovery key*, *Turn off*. The short "what it protects" text from design §5.6. Update SEC-4 wording in the Security page. [LOCK-1, LOCK-4, LOCK-6, SEC-4]
- [ ] 18.9 *Lock now* in the navigation and on `Ctrl/Cmd+Shift+L` (only when the lock is on): `lock_now` then a window reload. [LOCK-7]

**✅ Done when:**
- with the lock on, the data can't be opened without the PIN/password or the recovery key, even by copying the data folder to another account;
- a forgotten PIN is recovered with the recovery key;
- turning the lock off brings back V1's behaviour;
- all old backups still restore.

---

## Phase 19 — V1.5 release

- [ ] 19.1 Upgrade test: V1.5 ships no migration, and a V1.1 database opens and reads unchanged (extend `tests/upgrade.test.ts`). [NFR-3, DIST-3]
- [ ] 19.2 Manual check on Windows, macOS and Linux:
  - export, then import on another computer;
  - the lock with the OS keychain (and with the Linux key-file fallback);
  - the recovery key;
  - CSV in Excel/LibreOffice.
  [EXP-1..3, IMP, LOCK]
- [ ] 19.3 Version 1.5.0 and `RELEASE_NOTES.md` in the dev PR; the merge to `main` releases it (`docs/RELEASING.md`). [DIST-2]

**✅ Done when:** 1.5.0 is published, and updating from 1.1.0 keeps all data with the lock off.

---

## Requirement coverage

| Area | Requirements | Phases |
| --- | --- | --- |
| Export | EXP-1..3, EXP-8 | 16 |
| Import | IMP-1..7 | 17 |
| App lock | LOCK-1..8 | 18 |
| Changed V1 | SEC-4, DIST-5 | 16, 18 |
| Non-functional | NFR-12..16 (plus V1's NFR-1..11) | 16, 17, 18, 19 |
