//! `db_*` IPC commands (design §3.2). Thin wrappers over life_db_core.

use life_db_core::db::{Database, Statement};
use life_db_core::keystore::DeviceKey;
use life_db_core::{DbStatus, Error, Opened, Result};
use serde::Serialize;
use serde_json::{Map, Value as Json};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

pub struct AppDb {
    db: Option<Database>,
    key: Option<DeviceKey>,
    status: DbStatus,
    data_dir: PathBuf,
}

impl AppDb {
    pub fn new(opened: Opened, data_dir: PathBuf) -> Self {
        Self {
            db: opened.db,
            key: opened.key,
            status: opened.status,
            data_dir,
        }
    }
    fn db(&self) -> Result<&Database> {
        self.db
            .as_ref()
            .ok_or_else(|| Error::Invalid("database is not open".into()))
    }
    fn key(&self) -> Result<&DeviceKey> {
        self.key
            .as_ref()
            .ok_or_else(|| Error::Invalid("database is not open".into()))
    }
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
    state.db()?.query(&sql, &params)
}

#[tauri::command(async)]
pub fn db_execute(state: State<'_, AppDb>, sql: String, params: Vec<Json>) -> Result<Changes> {
    Ok(Changes {
        changes: state.db()?.execute(&sql, &params)?,
    })
}

#[tauri::command(async)]
pub fn db_transaction(state: State<'_, AppDb>, statements: Vec<Statement>) -> Result<()> {
    state.db()?.transaction(&statements)
}

#[tauri::command(async)]
pub fn db_run_script(state: State<'_, AppDb>, sql: String) -> Result<()> {
    state.db()?.run_script(&sql)
}

/// Manual backup to a user-chosen path (EXP-4).
#[tauri::command(async)]
pub fn db_backup(state: State<'_, AppDb>, dest_path: String) -> Result<()> {
    state
        .db()?
        .backup_to(&PathBuf::from(dest_path), state.key()?)
}

/// Backup into `<data>/backups/<label>-<unix ms>.lifedb` (pre-migration, automatic). Returns the path.
#[tauri::command(async)]
pub fn db_backup_internal(state: State<'_, AppDb>, label: String) -> Result<String> {
    if label.is_empty() || !label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(Error::Invalid("backup label must be [A-Za-z0-9-]".into()));
    }
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let dest = state
        .data_dir
        .join("backups")
        .join(format!("{label}-{ms}.lifedb"));
    state.db()?.backup_to(&dest, state.key()?)?;
    Ok(dest.display().to_string())
}

#[tauri::command]
pub fn db_info(state: State<'_, AppDb>) -> Result<DbInfo> {
    let db = state.db()?;
    Ok(DbInfo {
        path: db.path().display().to_string(),
        size_bytes: db.size_bytes(),
        backups_dir: state.data_dir.join("backups").display().to_string(),
    })
}
