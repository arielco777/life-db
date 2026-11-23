//! Export files (V1.5 design §2.4): writing exports atomically, reading them back (plain or
//! password-protected), and writing a folder of Markdown files without overwriting anything.

use crate::envelope::{Envelope, KdfParams};
use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

/// Larger than any real export (the 5-year test dataset is about 15 MB).
const MAX_EXPORT_BYTES: u64 = 512 * 1024 * 1024;

/// What reading an export found. Not errors: the UI handles each one.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum ReadOutcome {
    /// The export's text. The frontend checks that it is a Life DB export.
    Ok { text: String },
    /// A protected export, and no password was given.
    NeedsPassword,
    /// A protected export, and the password is wrong (or the file was altered).
    WrongPassword,
    /// Not text, so not an export.
    NotLifeDb,
}

#[derive(Debug, Deserialize)]
pub struct ExportFile {
    pub name: String,
    pub text: String,
}

/// Writes `bytes` to `path.tmp`, syncs it, then renames over `path`, so a crash never
/// leaves a half-written export where the user expects a whole one.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    let result = (|| {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    Ok(result?)
}

/// Writes an export, encrypted when `password` is given (EXP-1, EXP-8).
pub fn write_export(path: &Path, text: &str, password: Option<&str>) -> Result<()> {
    match password {
        Some(pw) => write_atomic(
            path,
            Envelope::protect(text.as_bytes(), pw, KdfParams::DEFAULT)?.as_bytes(),
        ),
        None => write_atomic(path, text.as_bytes()),
    }
}

/// Reads an export, decrypting it when it is protected (IMP-1).
pub fn read_export(path: &Path, password: Option<&str>) -> Result<ReadOutcome> {
    if fs::metadata(path)?.len() > MAX_EXPORT_BYTES {
        return Err(Error::Invalid(
            "This file is too large to be a Life DB export.".into(),
        ));
    }
    let bytes = fs::read(path)?;
    if let Some(env) = Envelope::parse(&bytes) {
        let Some(pw) = password else {
            return Ok(ReadOutcome::NeedsPassword);
        };
        return Ok(match env.unprotect(pw)? {
            Some(plain) => match std::str::from_utf8(&plain) {
                Ok(text) => ReadOutcome::Ok {
                    text: text.to_owned(),
                },
                Err(_) => ReadOutcome::NotLifeDb,
            },
            None => ReadOutcome::WrongPassword,
        });
    }
    Ok(match String::from_utf8(bytes) {
        Ok(text) => ReadOutcome::Ok { text },
        Err(_) => ReadOutcome::NotLifeDb,
    })
}

/// A single path component: no separators, no `.`/`..`, no control characters. The
/// frontend already makes names portable; this only guarantees nothing escapes `parent`.
fn check_name(name: &str) -> Result<()> {
    let bad = name.is_empty()
        || name.len() > 255
        || name == "."
        || name == ".."
        || name
            .chars()
            .any(|c| c == '/' || c == '\\' || c.is_control());
    if bad {
        return Err(Error::Invalid(format!("unsafe file name: {name:?}")));
    }
    Ok(())
}

/// Creates `parent/name` (or `name (2)`, `name (3)`… if taken) and writes every file into
/// it. Existing files are never overwritten (EXP-3). If any write fails, the new folder is
/// removed. Returns the folder's path.
pub fn write_folder(parent: &Path, name: &str, files: &[ExportFile]) -> Result<PathBuf> {
    check_name(name)?;
    for f in files {
        check_name(&f.name)?;
    }
    let mut folder = None;
    for i in 1..=1000 {
        let candidate = if i == 1 {
            parent.join(name)
        } else {
            parent.join(format!("{name} ({i})"))
        };
        match fs::create_dir(&candidate) {
            Ok(()) => {
                folder = Some(candidate);
                break;
            }
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.into()),
        }
    }
    let folder = folder.ok_or_else(|| Error::Invalid("no free folder name".into()))?;
    let result = files.iter().try_for_each(|f| -> Result<()> {
        let mut out = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(folder.join(&f.name))?;
        out.write_all(f.text.as_bytes())?;
        Ok(())
    });
    if let Err(e) = result {
        let _ = fs::remove_dir_all(&folder);
        return Err(e);
    }
    Ok(folder)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str, text: &str) -> ExportFile {
        ExportFile {
            name: name.into(),
            text: text.into(),
        }
    }

    #[test]
    fn plain_export_round_trip_overwrites_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("export.json");
        fs::write(&path, "old").unwrap();
        write_export(&path, r#"{"app":"life-db"}"#, None).unwrap();
        assert_eq!(
            read_export(&path, None).unwrap(),
            ReadOutcome::Ok {
                text: r#"{"app":"life-db"}"#.into()
            }
        );
        assert!(!dir.path().join("export.json.tmp").exists());
    }

    #[test]
    fn protected_export_needs_the_password() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("export.lifedb-export");
        let env = Envelope::protect(
            b"{\"secret\":1}",
            "correct horse",
            crate::envelope::tests_fast(),
        )
        .unwrap();
        fs::write(&path, env).unwrap();
        assert_eq!(
            read_export(&path, None).unwrap(),
            ReadOutcome::NeedsPassword
        );
        assert_eq!(
            read_export(&path, Some("nope nope")).unwrap(),
            ReadOutcome::WrongPassword
        );
        assert_eq!(
            read_export(&path, Some("correct horse")).unwrap(),
            ReadOutcome::Ok {
                text: "{\"secret\":1}".into()
            }
        );
    }

    #[test]
    fn binary_files_are_not_exports() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("photo.jpg");
        fs::write(&path, [0xff, 0xd8, 0xff, 0xe0, 0x80]).unwrap();
        assert_eq!(read_export(&path, None).unwrap(), ReadOutcome::NotLifeDb);
    }

    #[test]
    fn folder_never_overwrites_and_takes_a_free_name() {
        let dir = tempfile::tempdir().unwrap();
        let first = write_folder(dir.path(), "Journal", &[file("a.md", "A")]).unwrap();
        let second = write_folder(dir.path(), "Journal", &[file("a.md", "B")]).unwrap();
        assert_eq!(first, dir.path().join("Journal"));
        assert_eq!(second, dir.path().join("Journal (2)"));
        assert_eq!(fs::read_to_string(first.join("a.md")).unwrap(), "A");
        assert_eq!(fs::read_to_string(second.join("a.md")).unwrap(), "B");
    }

    #[test]
    fn unsafe_names_are_refused_and_failures_clean_up() {
        let dir = tempfile::tempdir().unwrap();
        for bad in ["../evil.md", "a/b.md", "a\\b.md", "..", "", "a\nb.md"] {
            assert!(
                write_folder(dir.path(), "J", &[file(bad, "x")]).is_err(),
                "{bad:?}"
            );
        }
        assert!(write_folder(dir.path(), "../J", &[]).is_err());
        // Two files with the same name: the second write fails, and the folder is removed.
        assert!(write_folder(dir.path(), "J", &[file("a.md", "1"), file("a.md", "2")]).is_err());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }
}
