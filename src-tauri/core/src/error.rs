use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Sql(#[from] rusqlite::Error),
    #[error("invalid SQL parameter: {0}")]
    Param(String),
    #[error("key store error: {0}")]
    KeyStore(String),
    #[error("the database could not be opened with this device's key")]
    WrongKey,
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Invalid(String),
    /// A backup that can't be restored. The message is written for the user (EXP-5).
    #[error("{0}")]
    Restore(String),
}

pub type Result<T> = std::result::Result<T, Error>;

/// Errors cross the Tauri IPC boundary as plain messages. They never include SQL
/// parameters, so user content does not leak into the frontend error log (SEC-3).
impl Serialize for Error {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}
