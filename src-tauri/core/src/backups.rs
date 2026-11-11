//! Restore (EXP-5) and automatic daily backups (EXP-6), design §6.9.

use crate::db::{Database, open_connection};
use crate::error::{Error, Result};
use crate::keystore::DeviceKey;
use rusqlite::OptionalExtension;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const BACKUPS_DIR: &str = "backups";
const AUTO_PREFIX: &str = "auto-";
const EXT: &str = "lifedb";

const NOT_FROM_THIS_DEVICE: &str = "This file isn't a Life DB backup from this device. Backups can only be restored on the device and user account that made them.";
const NOT_LIFE_DB: &str = "This file isn't a Life DB backup.";
const DAMAGED: &str = "This backup is damaged and can't be restored.";

fn unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// `<data>/backups/<label>-<unix ms>.lifedb`
pub fn labelled_backup_path(data_dir: &Path, label: &str) -> PathBuf {
    data_dir
        .join(BACKUPS_DIR)
        .join(format!("{label}-{}.{EXT}", unix_ms()))
}

/// Checks that `path` is a Life DB database this device can open, intact, and not from a
/// newer app (schema version ≤ `max_version`). Errors are `Error::Restore`, for people.
pub fn validate_backup(path: &Path, key: &DeviceKey, max_version: i64) -> Result<i64> {
    let conn = match open_connection(path, key) {
        Ok(c) => c,
        Err(Error::WrongKey | Error::Sql(_)) => {
            return Err(Error::Restore(NOT_FROM_THIS_DEVICE.into()));
        }
        Err(e) => return Err(e),
    };
    let check: String = conn
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|_| Error::Restore(DAMAGED.into()))?;
    if check != "ok" {
        return Err(Error::Restore(DAMAGED.into()));
    }
    let has_migrations: i64 = conn.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
        [],
        |r| r.get(0),
    )?;
    if has_migrations == 0 {
        return Err(Error::Restore(NOT_LIFE_DB.into()));
    }
    let version: Option<i64> = conn
        .query_row("SELECT max(version) FROM schema_migrations", [], |r| {
            r.get(0)
        })
        .optional()?
        .flatten();
    let version = version.ok_or_else(|| Error::Restore(NOT_LIFE_DB.into()))?;
    if version > max_version {
        return Err(Error::Restore(format!(
            "This backup was made by a newer version of Life DB (data version {version}; this app reads up to {max_version}). Update the app, then restore it."
        )));
    }
    Ok(version)
}

fn remove_if_exists(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

/// SQLite's sidecar files for `db` (`-wal`, `-shm`).
fn sidecars(db: &Path) -> [PathBuf; 2] {
    let name = db.as_os_str().to_owned();
    let with = |suffix: &str| {
        let mut n = name.clone();
        n.push(suffix);
        PathBuf::from(n)
    };
    [with("-wal"), with("-shm")]
}

/// Replaces the open database in `slot` with the backup at `src` (EXP-5):
/// copy `src` next to the live file, validate the copy, back up the current database to
/// `backups/pre-restore-<ms>.lifedb`, close it, swap the files and reopen. If anything
/// fails before the swap, nothing changes; if reopening fails after it, the old file is
/// put back. Returns the safety backup's path.
pub fn restore(
    slot: &mut Option<Database>,
    key: &DeviceKey,
    data_dir: &Path,
    src: &Path,
    max_version: i64,
) -> Result<PathBuf> {
    let current = slot
        .as_ref()
        .ok_or_else(|| Error::Invalid("database is not open".into()))?;
    let live = current.path().to_path_buf();
    if fs::canonicalize(src).ok() == fs::canonicalize(&live).ok() {
        return Err(Error::Restore(
            "That's the database Life DB is using now. Choose a backup file.".into(),
        ));
    }

    // Work on a private copy, so the user's file is never modified and can't change midway.
    let staging = data_dir.join("life.db.restoring");
    remove_if_exists(&staging)?;
    sidecars(&staging)
        .iter()
        .try_for_each(|p| remove_if_exists(p))?;
    fs::copy(src, &staging)?;
    if let Err(e) = validate_backup(&staging, key, max_version) {
        let _ = fs::remove_file(&staging);
        return Err(e);
    }

    let safety = labelled_backup_path(data_dir, "pre-restore");
    if let Err(e) = current.backup_to(&safety, key) {
        let _ = fs::remove_file(&staging);
        return Err(e);
    }

    // Close the live database. Its data is in the safety backup; any leftover WAL must not
    // be applied to the restored file.
    *slot = None;
    let old = data_dir.join("life.db.old");
    let mut moved_aside = false;
    let swapped = (|| -> Result<Database> {
        remove_if_exists(&old)?;
        fs::rename(&live, &old)?;
        moved_aside = true;
        sidecars(&live)
            .iter()
            .try_for_each(|p| remove_if_exists(p))?;
        fs::rename(&staging, &live)?;
        Database::open(&live, key)
    })();
    match swapped {
        Ok(db) => {
            *slot = Some(db);
            let _ = fs::remove_file(&old);
            Ok(safety)
        }
        Err(e) => {
            // Put the previous database back (if it was moved) and reopen it, so the app
            // keeps working whatever step failed.
            if moved_aside {
                let _ = fs::remove_file(&live);
                sidecars(&live).iter().for_each(|p| {
                    let _ = fs::remove_file(p);
                });
                fs::rename(&old, &live)?;
            }
            let _ = fs::remove_file(&staging);
            *slot = Some(Database::open(&live, key)?);
            Err(e)
        }
    }
}

/// `today` must be a calendar date, `YYYY-MM-DD`.
fn is_iso_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b.iter().enumerate().all(|(i, c)| {
            if i == 4 || i == 7 {
                *c == b'-'
            } else {
                c.is_ascii_digit()
            }
        })
}

/// Automatic backups in `dir`, newest first (names sort by date).
pub fn auto_backups(dir: &Path) -> Result<Vec<PathBuf>> {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e.into()),
    };
    let mut found: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .and_then(|n| n.strip_prefix(AUTO_PREFIX))
                .and_then(|n| n.strip_suffix(&format!(".{EXT}")))
                .is_some_and(is_iso_date)
        })
        .collect();
    found.sort();
    found.reverse();
    Ok(found)
}

/// Date (`YYYY-MM-DD`) of the newest automatic backup in `<data_dir>/backups`, if any.
pub fn last_auto_backup(data_dir: &Path) -> Result<Option<String>> {
    Ok(auto_backups(&data_dir.join(BACKUPS_DIR))?
        .first()
        .and_then(|p| {
            p.file_name()?
                .to_str()?
                .get(AUTO_PREFIX.len()..AUTO_PREFIX.len() + 10)
        })
        .map(String::from))
}

/// Once a day (EXP-6): if there's no `auto-<today>.lifedb` yet, write one, then delete the
/// oldest automatic backups beyond `keep`. Other backups (pre-migration, pre-restore,
/// manual) are never touched. Returns the new backup's path, or None if today's exists.
pub fn auto_backup(
    db: &Database,
    key: &DeviceKey,
    data_dir: &Path,
    today: &str,
    keep: usize,
) -> Result<Option<PathBuf>> {
    if !is_iso_date(today) {
        return Err(Error::Invalid("today must be YYYY-MM-DD".into()));
    }
    let dir = data_dir.join(BACKUPS_DIR);
    let dest = dir.join(format!("{AUTO_PREFIX}{today}.{EXT}"));
    let created = if dest.exists() {
        None
    } else {
        db.backup_to(&dest, key)?;
        Some(dest)
    };
    for stale in auto_backups(&dir)?.into_iter().skip(keep.max(1)) {
        fs::remove_file(stale)?;
    }
    Ok(created)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keystore::generate_key;
    use serde_json::json;

    /// A minimal Life DB at `<dir>/life.db` with schema version `version` and one note.
    fn life_db(dir: &Path, key: &DeviceKey, version: i64, note: &str) -> Database {
        let db = Database::open(dir.join("life.db"), key).unwrap();
        db.run_script(&format!(
            "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);
             INSERT INTO schema_migrations VALUES ({version}, 'v', '2026-01-01');
             CREATE TABLE notes (body TEXT);"
        ))
        .unwrap();
        db.execute("INSERT INTO notes VALUES (?)", &[json!(note)])
            .unwrap();
        db
    }

    fn notes(db: &Database) -> Vec<serde_json::Value> {
        db.query("SELECT body FROM notes", &[])
            .unwrap()
            .into_iter()
            .map(|r| r["body"].clone())
            .collect()
    }

    #[test]
    fn restore_round_trip_keeps_a_safety_copy() {
        let dir = tempfile::tempdir().unwrap();
        let key = generate_key().unwrap();
        let db = life_db(dir.path(), &key, 3, "monday");
        let backup = dir.path().join("elsewhere/monday.lifedb");
        db.backup_to(&backup, &key).unwrap();
        db.execute("UPDATE notes SET body = 'tuesday'", &[])
            .unwrap();

        let mut slot = Some(db);
        let safety = restore(&mut slot, &key, dir.path(), &backup, 3).unwrap();
        assert_eq!(notes(slot.as_ref().unwrap()), vec![json!("monday")]);
        // The data being replaced is kept, and still opens.
        assert!(safety.starts_with(dir.path().join("backups")));
        assert_eq!(
            notes(&Database::open(&safety, &key).unwrap()),
            vec![json!("tuesday")]
        );
        // The chosen file is left alone; no temp files remain.
        assert!(backup.exists());
        assert!(!dir.path().join("life.db.restoring").exists());
        assert!(!dir.path().join("life.db.old").exists());
        // The restored database is the live one: writes stick across reopen.
        slot.as_ref()
            .unwrap()
            .execute("INSERT INTO notes VALUES ('after')", &[])
            .unwrap();
        drop(slot);
        let reopened = Database::open(dir.path().join("life.db"), &key).unwrap();
        assert_eq!(notes(&reopened), vec![json!("monday"), json!("after")]);
    }

    #[test]
    fn rejects_bad_files_without_touching_the_live_database() {
        let dir = tempfile::tempdir().unwrap();
        let key = generate_key().unwrap();
        let mut slot = Some(life_db(dir.path(), &key, 3, "live"));
        let other = tempfile::tempdir().unwrap();

        // Another device's key.
        let foreign_key = generate_key().unwrap();
        drop(life_db(other.path(), &foreign_key, 3, "x"));
        let foreign = other.path().join("life.db");
        // Newer app.
        let newer_dir = tempfile::tempdir().unwrap();
        drop(life_db(newer_dir.path(), &key, 9, "x"));
        let newer = newer_dir.path().join("life.db");
        // Opens with our key, but isn't a Life DB.
        let plain_dir = tempfile::tempdir().unwrap();
        let plain = plain_dir.path().join("other.db");
        Database::open(&plain, &key)
            .unwrap()
            .run_script("CREATE TABLE t (a);")
            .unwrap();
        // Not a database at all.
        let text = other.path().join("notes.txt");
        fs::write(&text, "hello").unwrap();

        let mut message = |src: &Path| match restore(&mut slot, &key, dir.path(), src, 3) {
            Err(Error::Restore(m)) => m,
            other => panic!("expected a restore error, got {other:?}"),
        };
        assert!(message(&foreign).contains("from this device"));
        assert!(message(&text).contains("from this device"));
        assert!(message(&newer).contains("newer version"));
        assert_eq!(message(&plain), NOT_LIFE_DB);
        let live = dir.path().join("life.db");
        assert!(message(&live).contains("using now"));

        assert_eq!(notes(slot.as_ref().unwrap()), vec![json!("live")]);
        assert!(
            !dir.path().join("backups").exists(),
            "no safety copy for a rejected file"
        );
        assert!(!dir.path().join("life.db.restoring").exists());
    }

    #[test]
    fn auto_backup_once_a_day_keeping_the_newest() {
        let dir = tempfile::tempdir().unwrap();
        let key = generate_key().unwrap();
        let db = life_db(dir.path(), &key, 3, "x");
        let backups = dir.path().join(BACKUPS_DIR);
        fs::create_dir_all(&backups).unwrap();
        fs::write(backups.join("pre-migration-v1-to-v2-1.lifedb"), "keep me").unwrap();
        fs::write(backups.join("auto-notes.lifedb"), "not ours").unwrap();

        for day in ["2026-08-01", "2026-08-02", "2026-08-03"] {
            assert!(
                auto_backup(&db, &key, dir.path(), day, 2)
                    .unwrap()
                    .is_some()
            );
        }
        // Same day again: nothing new.
        assert_eq!(
            auto_backup(&db, &key, dir.path(), "2026-08-03", 2).unwrap(),
            None
        );

        let names: Vec<String> = auto_backups(&backups)
            .unwrap()
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["auto-2026-08-03.lifedb", "auto-2026-08-02.lifedb"]);
        assert!(backups.join("pre-migration-v1-to-v2-1.lifedb").exists());
        assert!(backups.join("auto-notes.lifedb").exists());
        assert!(Database::open(backups.join("auto-2026-08-03.lifedb"), &key).is_ok());
        assert!(auto_backup(&db, &key, dir.path(), "08/03/2026", 2).is_err());
        assert_eq!(
            last_auto_backup(dir.path()).unwrap().as_deref(),
            Some("2026-08-03")
        );
        assert_eq!(last_auto_backup(&dir.path().join("nowhere")).unwrap(), None);
    }
}
