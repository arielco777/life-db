//! Life DB core: encrypted SQLite + device-key storage. Tauri-independent so it can be
//! tested (and reused by mobile builds) without a webview.

pub mod backups;
pub mod db;
pub mod error;
pub mod keystore;

use db::Database;
use keystore::{KeyResolution, KeyStore};
use serde::Serialize;
use std::path::Path;

pub use error::{Error, Result};

pub const DB_FILE: &str = "life.db";
pub const KEY_FILE: &str = "device.key";

/// What the frontend learns at startup (`db_status`).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum DbStatus {
    #[serde(rename_all = "camelCase")]
    Open {
        path: String,
        created_now: bool,
        key_fallback: bool,
    },
    /// DB exists but its key is gone (SEC-2; no recovery in V1).
    KeyMissing {
        path: String,
    },
    Error {
        message: String,
    },
}

pub struct Opened {
    pub db: Option<Database>,
    pub key: Option<keystore::DeviceKey>,
    pub status: DbStatus,
}

/// Finds or creates the device key, then opens (or creates) `<data_dir>/life.db`.
pub fn open_app_database(data_dir: &Path, primary: &dyn KeyStore) -> Opened {
    let path = data_dir.join(DB_FILE);
    let path_str = path.display().to_string();
    let fail = |message: String| Opened {
        db: None,
        key: None,
        status: DbStatus::Error { message },
    };

    if let Err(e) = std::fs::create_dir_all(data_dir) {
        return fail(e.to_string());
    }
    let fallback = keystore::FileKeyStore {
        path: data_dir.join(KEY_FILE),
    };
    let (key, created_now, key_fallback) =
        match keystore::resolve_key(primary, &fallback, path.exists()) {
            Ok(KeyResolution::Found { key, fallback }) => (key, false, fallback),
            Ok(KeyResolution::Created { key, fallback }) => (key, true, fallback),
            Ok(KeyResolution::Missing) => {
                return Opened {
                    db: None,
                    key: None,
                    status: DbStatus::KeyMissing { path: path_str },
                };
            }
            Ok(KeyResolution::StoreUnavailable(msg)) => {
                return fail(format!("The system key store is unavailable: {msg}"));
            }
            Err(e) => return fail(e.to_string()),
        };
    match Database::open(&path, &key) {
        Ok(db) => Opened {
            db: Some(db),
            key: Some(key),
            status: DbStatus::Open {
                path: path_str,
                created_now,
                key_fallback,
            },
        },
        Err(Error::WrongKey) => Opened {
            db: None,
            key: None,
            status: DbStatus::KeyMissing { path: path_str },
        },
        Err(e) => fail(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use keystore::MemoryKeyStore;

    #[test]
    fn first_launch_then_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryKeyStore::default();
        let first = open_app_database(dir.path(), &store);
        assert!(matches!(
            first.status,
            DbStatus::Open {
                created_now: true,
                key_fallback: false,
                ..
            }
        ));
        first
            .db
            .unwrap()
            .execute("CREATE TABLE x (a)", &[])
            .unwrap();
        let again = open_app_database(dir.path(), &store);
        assert!(matches!(
            again.status,
            DbStatus::Open {
                created_now: false,
                ..
            }
        ));
    }

    #[test]
    fn lost_key_reports_key_missing() {
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryKeyStore::default();
        drop(open_app_database(dir.path(), &store));
        let fresh_store = MemoryKeyStore::default(); // e.g. keyring wiped
        let r = open_app_database(dir.path(), &fresh_store);
        assert!(matches!(r.status, DbStatus::KeyMissing { .. }));
        assert!(r.db.is_none());
    }

    #[test]
    fn status_serializes_for_the_frontend() {
        let s = DbStatus::Open {
            path: "/p".into(),
            created_now: true,
            key_fallback: false,
        };
        assert_eq!(
            serde_json::to_value(&s).unwrap(),
            serde_json::json!({ "state": "open", "path": "/p", "createdNow": true, "keyFallback": false })
        );
    }
}
