//! `db_*` IPC commands (design §3.2). Thin wrappers over life_db_core.

use life_db_core::backups::{self, BACKUPS_DIR};
use life_db_core::db::{Database, Statement};
use life_db_core::keystore::DeviceKey;
use life_db_core::{DbStatus, Error, KEY_FILE, Opened, Result};
use serde::Serialize;
use serde_json::{Map, Value as Json};
use std::path::PathBuf;
use std::sync::RwLock;
use tauri::State;

pub struct AppDb {
    /// Write-locked only while a restore swaps the file (EXP-5); every other command reads.
    db: RwLock<Option<Database>>,
    key: Option<DeviceKey>,
    status: DbStatus,
    data_dir: PathBuf,
}

impl AppDb {
    pub fn new(opened: Opened, data_dir: PathBuf) -> Self {
        Self {
            db: RwLock::new(opened.db),
            key: opened.key,
            status: opened.status,
            data_dir,
        }
    }
    /// Runs `f` with the open database.
    fn with_db<T>(&self, f: impl FnOnce(&Database) -> Result<T>) -> Result<T> {
        let guard = self.db.read().unwrap_or_else(|p| p.into_inner());
        f(guard.as_ref().ok_or_else(not_open)?)
    }
    fn key(&self) -> Result<&DeviceKey> {
        self.key.as_ref().ok_or_else(not_open)
    }
}

fn not_open() -> Error {
    Error::Invalid("database is not open".into())
}

#[derive(Serialize)]
pub struct Changes {
    changes: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbInfo {
    path: String,
    size_bytes: u64,
    backups_dir: String,
    /// The device key is in a file in the data folder, not the OS credential store (SEC-2).
    key_file: Option<String>,
    /// Date of the newest automatic backup (EXP-6).
    last_auto_backup: Option<String>,
}

#[tauri::command]
pub fn db_status(state: State<'_, AppDb>) -> DbStatus {
    state.status.clone()
}

#[tauri::command(async)]
pub fn db_query(
    state: State<'_, AppDb>,
    sql: String,
    params: Vec<Json>,
) -> Result<Vec<Map<String, Json>>> {
    state.with_db(|db| db.query(&sql, &params))
}

#[tauri::command(async)]
pub fn db_execute(state: State<'_, AppDb>, sql: String, params: Vec<Json>) -> Result<Changes> {
    state.with_db(|db| {
        Ok(Changes {
            changes: db.execute(&sql, &params)?,
        })
    })
}

#[tauri::command(async)]
pub fn db_transaction(state: State<'_, AppDb>, statements: Vec<Statement>) -> Result<()> {
    state.with_db(|db| db.transaction(&statements))
}

#[tauri::command(async)]
pub fn db_run_script(state: State<'_, AppDb>, sql: String) -> Result<()> {
    state.with_db(|db| db.run_script(&sql))
}

/// Manual backup to a user-chosen path (EXP-4).
#[tauri::command(async)]
pub fn db_backup(state: State<'_, AppDb>, dest_path: String) -> Result<()> {
    let key = state.key()?;
    state.with_db(|db| db.backup_to(&PathBuf::from(dest_path), key))
}

/// Backup into `<data>/backups/<label>-<unix ms>.lifedb` (pre-migration). Returns the path.
#[tauri::command(async)]
pub fn db_backup_internal(state: State<'_, AppDb>, label: String) -> Result<String> {
    if label.is_empty() || !label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(Error::Invalid("backup label must be [A-Za-z0-9-]".into()));
    }
    let dest = backups::labelled_backup_path(&state.data_dir, &label);
    let key = state.key()?;
    state.with_db(|db| db.backup_to(&dest, key))?;
    Ok(dest.display().to_string())
}

/// Daily automatic backup, pruned to `keep_count` (EXP-6). Returns the new file's path,
/// or null if today's backup already exists.
#[tauri::command(async)]
pub fn db_auto_backup(
    state: State<'_, AppDb>,
    today: String,
    keep_count: usize,
) -> Result<Option<String>> {
    let key = state.key()?;
    let created =
        state.with_db(|db| backups::auto_backup(db, key, &state.data_dir, &today, keep_count))?;
    Ok(created.map(|p| p.display().to_string()))
}

/// Replaces the database with a backup (EXP-5). `max_version` is the newest schema this
/// app knows. Returns the path of the automatic copy of the replaced data. The frontend
/// reloads afterwards.
#[tauri::command(async)]
pub fn db_restore(state: State<'_, AppDb>, src_path: String, max_version: i64) -> Result<String> {
    let key = state.key()?;
    let mut slot = state.db.write().unwrap_or_else(|p| p.into_inner());
    let safety = backups::restore(
        &mut slot,
        key,
        &state.data_dir,
        &PathBuf::from(src_path),
        max_version,
    )?;
    Ok(safety.display().to_string())
}

#[tauri::command]
pub fn db_info(state: State<'_, AppDb>) -> Result<DbInfo> {
    let key_fallback = matches!(
        state.status,
        DbStatus::Open {
            key_fallback: true,
            ..
        }
    );
    state.with_db(|db| {
        Ok(DbInfo {
            path: db.path().display().to_string(),
            size_bytes: db.size_bytes(),
            backups_dir: state.data_dir.join(BACKUPS_DIR).display().to_string(),
            key_file: key_fallback.then(|| state.data_dir.join(KEY_FILE).display().to_string()),
            last_auto_backup: backups::last_auto_backup(&state.data_dir)?,
        })
    })
}
