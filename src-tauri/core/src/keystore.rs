//! Device key storage (SEC-2). The key never sits in plain text next to the database,
//! except in the explicit file fallback for systems without a credential store.

use crate::error::{Error, Result};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

pub const KEY_LEN: usize = 32;
pub type DeviceKey = [u8; KEY_LEN];

/// Where the device key lives. Mobile builds will add Keychain/Keystore implementations.
pub trait KeyStore: Send + Sync {
    /// `Ok(None)` = the store works but holds no key. `Err` = the store is unavailable.
    fn load(&self) -> Result<Option<DeviceKey>>;
    fn save(&self, key: &DeviceKey) -> Result<()>;
}

fn to_key(bytes: &[u8]) -> Result<DeviceKey> {
    bytes.try_into().map_err(|_| {
        Error::KeyStore(format!(
            "stored key has {} bytes, expected {KEY_LEN}",
            bytes.len()
        ))
    })
}

pub fn generate_key() -> Result<DeviceKey> {
    let mut key = [0u8; KEY_LEN];
    getrandom::fill(&mut key).map_err(|e| Error::KeyStore(format!("no OS randomness: {e}")))?;
    Ok(key)
}

/// OS credential store: Windows Credential Manager, macOS Keychain, Linux Secret Service.
pub struct OsKeyStore {
    service: String,
    account: String,
}

impl OsKeyStore {
    pub fn new(service: impl Into<String>, account: impl Into<String>) -> Self {
        Self {
            service: service.into(),
            account: account.into(),
        }
    }
    fn entry(&self) -> Result<keyring::Entry> {
        keyring::Entry::new(&self.service, &self.account)
            .map_err(|e| Error::KeyStore(e.to_string()))
    }
}

impl KeyStore for OsKeyStore {
    fn load(&self) -> Result<Option<DeviceKey>> {
        match self.entry()?.get_secret() {
            Ok(bytes) => to_key(&bytes).map(Some),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(Error::KeyStore(e.to_string())),
        }
    }
    fn save(&self, key: &DeviceKey) -> Result<()> {
        self.entry()?
            .set_secret(key)
            .map_err(|e| Error::KeyStore(e.to_string()))?;
        // Read back: some backends accept writes they cannot return.
        match self.load()? {
            Some(k) if &k == key => Ok(()),
            _ => Err(Error::KeyStore(
                "key could not be read back after saving".into(),
            )),
        }
    }
}

/// Fallback: hex key in a file readable only by the user (0600 on Unix).
pub struct FileKeyStore {
    pub path: PathBuf,
}

impl KeyStore for FileKeyStore {
    fn load(&self) -> Result<Option<DeviceKey>> {
        match fs::read_to_string(&self.path) {
            Ok(s) => {
                let bytes = hex::decode(s.trim())
                    .map_err(|e| Error::KeyStore(format!("bad key file: {e}")))?;
                to_key(&bytes).map(Some)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
    fn save(&self, key: &DeviceKey) -> Result<()> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let mut opts = fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts.open(&self.path)?;
        f.write_all(hex::encode(key).as_bytes())?;
        f.sync_all()?;
        Ok(())
    }
}

/// In-memory store for tests.
#[derive(Default)]
pub struct MemoryKeyStore {
    pub key: Mutex<Option<DeviceKey>>,
    pub unavailable: bool,
}

impl KeyStore for MemoryKeyStore {
    fn load(&self) -> Result<Option<DeviceKey>> {
        if self.unavailable {
            return Err(Error::KeyStore("unavailable".into()));
        }
        Ok(*self.key.lock().unwrap())
    }
    fn save(&self, key: &DeviceKey) -> Result<()> {
        if self.unavailable {
            return Err(Error::KeyStore("unavailable".into()));
        }
        *self.key.lock().unwrap() = Some(*key);
        Ok(())
    }
}

/// Outcome of finding (or creating) the device key.
#[derive(Debug, PartialEq, Eq)]
pub enum KeyResolution {
    /// `fallback`: the key lives in the key file rather than the OS store.
    Found {
        key: DeviceKey,
        fallback: bool,
    },
    Created {
        key: DeviceKey,
        fallback: bool,
    },
    /// A database exists but no key can be found anywhere (V1: no recovery).
    Missing,
    /// The OS store failed and no fallback key exists, while a database exists.
    StoreUnavailable(String),
}

/// SEC-2 key lifecycle (design §3.3).
pub fn resolve_key(
    primary: &dyn KeyStore,
    fallback: &dyn KeyStore,
    db_exists: bool,
) -> Result<KeyResolution> {
    let primary_result = primary.load();
    if let Ok(Some(key)) = primary_result {
        return Ok(KeyResolution::Found {
            key,
            fallback: false,
        });
    }
    if let Some(key) = fallback.load()? {
        return Ok(KeyResolution::Found {
            key,
            fallback: true,
        });
    }
    if db_exists {
        return Ok(match primary_result {
            Err(e) => KeyResolution::StoreUnavailable(e.to_string()),
            _ => KeyResolution::Missing,
        });
    }
    // First run: create a key, preferring the OS store.
    let key = generate_key()?;
    if primary_result.is_ok() && primary.save(&key).is_ok() {
        return Ok(KeyResolution::Created {
            key,
            fallback: false,
        });
    }
    fallback.save(&key)?;
    Ok(KeyResolution::Created {
        key,
        fallback: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stores() -> (MemoryKeyStore, MemoryKeyStore) {
        (MemoryKeyStore::default(), MemoryKeyStore::default())
    }

    #[test]
    fn first_run_creates_key_in_primary() {
        let (p, f) = stores();
        let r = resolve_key(&p, &f, false).unwrap();
        let KeyResolution::Created {
            key,
            fallback: false,
        } = r
        else {
            panic!("{r:?}")
        };
        assert_eq!(p.load().unwrap(), Some(key));
        assert_eq!(f.load().unwrap(), None);
        assert_eq!(
            resolve_key(&p, &f, true).unwrap(),
            KeyResolution::Found {
                key,
                fallback: false
            }
        );
    }

    #[test]
    fn falls_back_to_file_when_os_store_unavailable() {
        let p = MemoryKeyStore {
            unavailable: true,
            ..Default::default()
        };
        let f = MemoryKeyStore::default();
        let KeyResolution::Created {
            key,
            fallback: true,
        } = resolve_key(&p, &f, false).unwrap()
        else {
            panic!()
        };
        assert_eq!(
            resolve_key(&p, &f, true).unwrap(),
            KeyResolution::Found {
                key,
                fallback: true
            }
        );
    }

    #[test]
    fn missing_key_with_existing_db_is_reported() {
        let (p, f) = stores();
        assert_eq!(resolve_key(&p, &f, true).unwrap(), KeyResolution::Missing);
        let p = MemoryKeyStore {
            unavailable: true,
            ..Default::default()
        };
        assert!(matches!(
            resolve_key(&p, &f, true).unwrap(),
            KeyResolution::StoreUnavailable(_)
        ));
    }

    #[test]
    fn file_store_round_trip_and_permissions() {
        let dir = tempfile::tempdir().unwrap();
        let fs_store = FileKeyStore {
            path: dir.path().join("sub/key"),
        };
        assert_eq!(fs_store.load().unwrap(), None);
        let key = generate_key().unwrap();
        fs_store.save(&key).unwrap();
        assert_eq!(fs_store.load().unwrap(), Some(key));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&fs_store.path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
    }
}
