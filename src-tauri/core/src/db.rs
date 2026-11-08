//! Encrypted SQLite access (design §3.2). One connection behind a mutex.

use crate::error::{Error, Result};
use crate::keystore::DeviceKey;
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{Connection, params_from_iter};
use serde::Deserialize;
use serde_json::{Map, Number, Value as Json};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, Deserialize)]
pub struct Statement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Json>,
}

pub struct Database {
    conn: Mutex<Connection>,
    path: PathBuf,
}

/// Opens `path` with the raw device key and verifies the key actually decrypts it.
fn open_connection(path: &Path, key: &DeviceKey) -> Result<Connection> {
    let conn = Connection::open(path)?;
    // Must be the first statement on the connection (SEC-1). Raw-key syntax skips PBKDF2.
    conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex::encode(key)))?;
    // A wrong key surfaces here as "file is not a database".
    if conn
        .query_row("SELECT count(*) FROM sqlite_master", [], |r| {
            r.get::<_, i64>(0)
        })
        .is_err()
    {
        return Err(Error::WrongKey);
    }
    Ok(conn)
}

impl Database {
    pub fn open(path: impl Into<PathBuf>, key: &DeviceKey) -> Result<Self> {
        let path = path.into();
        let conn = open_connection(&path, key)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;
             PRAGMA temp_store = MEMORY;",
        )?;
        Ok(Self {
            conn: Mutex::new(conn),
            path,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        // A panic while holding the lock cannot leave a half-applied transaction
        // (rusqlite rolls back on drop), so recovering the guard is safe.
        self.conn.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn query(&self, sql: &str, params: &[Json]) -> Result<Vec<Map<String, Json>>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(sql)?;
        let names: Vec<String> = stmt.column_names().map(String::from).collect();
        let mut rows = stmt.query(params_from_iter(to_sql_values(params)?))?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            let mut obj = Map::with_capacity(names.len());
            for (i, name) in names.iter().enumerate() {
                obj.insert(name.clone(), to_json(row.get_ref(i)?));
            }
            out.push(obj);
        }
        Ok(out)
    }

    pub fn execute(&self, sql: &str, params: &[Json]) -> Result<usize> {
        let conn = self.lock();
        Ok(conn.execute(sql, params_from_iter(to_sql_values(params)?))?)
    }

    /// All statements in one transaction; any error rolls everything back (NFR-3).
    pub fn transaction(&self, statements: &[Statement]) -> Result<()> {
        let mut conn = self.lock();
        let tx = conn.transaction()?;
        for s in statements {
            tx.execute(&s.sql, params_from_iter(to_sql_values(&s.params)?))?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Multi-statement script (migrations), atomically.
    pub fn run_script(&self, sql: &str) -> Result<()> {
        let mut conn = self.lock();
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.commit()?;
        Ok(())
    }

    /// Consistent copy to `dest`, encrypted with the same device key (EXP-4).
    pub fn backup_to(&self, dest: &Path, key: &DeviceKey) -> Result<()> {
        if dest == self.path {
            return Err(Error::Invalid(
                "backup destination is the live database".into(),
            ));
        }
        if let Some(dir) = dest.parent() {
            std::fs::create_dir_all(dir)?;
        }
        // Write to a temp file and rename, so a failed backup never leaves a corrupt file.
        let tmp = dest.with_extension("partial");
        let _ = std::fs::remove_file(&tmp);
        {
            let mut dst = open_connection(&tmp, key)?;
            let src = self.lock();
            let backup = rusqlite::backup::Backup::new(&src, &mut dst)?;
            backup.run_to_completion(256, std::time::Duration::from_millis(0), None)?;
        }
        std::fs::rename(&tmp, dest)?;
        Ok(())
    }

    pub fn size_bytes(&self) -> u64 {
        std::fs::metadata(&self.path).map(|m| m.len()).unwrap_or(0)
    }
}

fn to_sql_values(params: &[Json]) -> Result<Vec<SqlValue>> {
    params
        .iter()
        .map(|p| match p {
            Json::Null => Ok(SqlValue::Null),
            Json::Bool(b) => Ok(SqlValue::Integer(i64::from(*b))),
            Json::Number(n) => n
                .as_i64()
                .map(SqlValue::Integer)
                .or_else(|| n.as_f64().map(SqlValue::Real))
                .ok_or_else(|| Error::Param("number out of range".into())),
            Json::String(s) => Ok(SqlValue::Text(s.clone())),
            Json::Array(_) | Json::Object(_) => {
                Err(Error::Param("arrays/objects are not bindable".into()))
            }
        })
        .collect()
}

fn to_json(v: ValueRef<'_>) -> Json {
    match v {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(i) => Json::Number(i.into()),
        ValueRef::Real(f) => Number::from_f64(f).map(Json::Number).unwrap_or(Json::Null),
        ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Json::String(hex::encode(b)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keystore::generate_key;
    use serde_json::json;

    fn temp_db() -> (tempfile::TempDir, Database, DeviceKey) {
        let dir = tempfile::tempdir().unwrap();
        let key = generate_key().unwrap();
        let db = Database::open(dir.path().join("life.db"), &key).unwrap();
        db.run_script("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL, v REAL);")
            .unwrap();
        (dir, db, key)
    }

    #[test]
    fn query_and_execute_round_trip_types() {
        let (_d, db, _k) = temp_db();
        db.execute(
            "INSERT INTO t (name, v) VALUES (?, ?)",
            &[json!("a"), json!(2.5)],
        )
        .unwrap();
        db.execute(
            "INSERT INTO t (name, v) VALUES (?, ?)",
            &[json!("b"), json!(null)],
        )
        .unwrap();
        let rows = db.query("SELECT name, v FROM t ORDER BY id", &[]).unwrap();
        assert_eq!(
            Json::from(rows),
            json!([{ "name": "a", "v": 2.5 }, { "name": "b", "v": null }])
        );
        assert!(
            db.execute("INSERT INTO t (name) VALUES (?)", &[json!([1])])
                .is_err()
        );
    }

    #[test]
    fn transaction_rolls_back_on_error() {
        let (_d, db, _k) = temp_db();
        let stmts = vec![
            Statement {
                sql: "INSERT INTO t (name) VALUES ('ok')".into(),
                params: vec![],
            },
            Statement {
                sql: "INSERT INTO t (name) VALUES (NULL)".into(),
                params: vec![],
            },
        ];
        assert!(db.transaction(&stmts).is_err());
        assert_eq!(
            db.query("SELECT count(*) AS n FROM t", &[]).unwrap()[0]["n"],
            json!(0)
        );
        assert!(
            db.run_script("INSERT INTO t (name) VALUES ('x'); SELECT * FROM nope;")
                .is_err()
        );
        assert_eq!(
            db.query("SELECT count(*) AS n FROM t", &[]).unwrap()[0]["n"],
            json!(0)
        );
    }

    #[test]
    fn file_is_encrypted_and_wrong_key_rejected() {
        let (dir, db, _k) = temp_db();
        db.execute("INSERT INTO t (name) VALUES ('secret journal text')", &[])
            .unwrap();
        db.lock()
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .unwrap();
        let bytes = std::fs::read(dir.path().join("life.db")).unwrap();
        assert!(!bytes.windows(6).any(|w| w == b"secret"));
        assert!(!bytes.starts_with(b"SQLite format 3"));
        let other = generate_key().unwrap();
        assert!(matches!(
            Database::open(dir.path().join("life.db"), &other),
            Err(Error::WrongKey)
        ));
    }

    #[test]
    fn plain_sqlite_cannot_read_it() {
        let (dir, db, _k) = temp_db();
        drop(db);
        let plain = Connection::open(dir.path().join("life.db")).unwrap();
        assert!(
            plain
                .query_row("SELECT count(*) FROM sqlite_master", [], |r| r
                    .get::<_, i64>(0))
                .is_err()
        );
    }

    #[test]
    fn backup_restores_with_same_key_only() {
        let (dir, db, key) = temp_db();
        db.execute("INSERT INTO t (name) VALUES ('kept')", &[])
            .unwrap();
        let dest = dir.path().join("backups/b.lifedb");
        db.backup_to(&dest, &key).unwrap();
        let copy = Database::open(&dest, &key).unwrap();
        assert_eq!(
            copy.query("SELECT name FROM t", &[]).unwrap()[0]["name"],
            json!("kept")
        );
        assert!(matches!(
            Database::open(&dest, &generate_key().unwrap()),
            Err(Error::WrongKey)
        ));
        assert!(db.backup_to(db.path(), &key).is_err());
    }

    #[test]
    fn fts5_is_available_under_sqlcipher() {
        let (_d, db, _k) = temp_db();
        db.run_script(
            "CREATE VIRTUAL TABLE s USING fts5(body, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3');
             INSERT INTO s (body) VALUES ('Practised my français');",
        )
        .unwrap();
        let rows = db
            .query(
                "SELECT body FROM s WHERE s MATCH ?",
                &[json!("\"francais\"")],
            )
            .unwrap();
        assert_eq!(rows.len(), 1);
    }
}
