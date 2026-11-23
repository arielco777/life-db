//! Password encryption (V1.5 design §2.3): Argon2id derives a key from the password, and
//! AES-256-GCM encrypts with the readable header as associated data. Used for protected
//! exports (EXP-8) and, later, for wrapping the device key under the app lock (LOCK-2).

use crate::error::{Error, Result};
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;
use zeroize::Zeroizing;

pub const KEY_LEN: usize = 32;
pub const SALT_LEN: usize = 16;
pub const NONCE_LEN: usize = 12;
/// Exports are passwords typed by people; anything shorter is refused (EXP-8).
pub const MIN_PASSWORD_CHARS: usize = 8;

/// Argon2id cost: memory in KiB, passes, lanes. Stored with every envelope, so the
/// defaults can be raised later without breaking older files.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct KdfParams {
    pub m: u32,
    pub t: u32,
    pub p: u32,
}

impl KdfParams {
    /// 64 MiB, 3 passes: about half a second on a laptop, and costly to guess on a GPU.
    pub const DEFAULT: Self = Self {
        m: 64 * 1024,
        t: 3,
        p: 1,
    };

    /// Parameters come from files, which anyone can edit. Refuse ones that would make
    /// opening a file use gigabytes of memory or minutes of CPU.
    fn checked(self) -> Result<Params> {
        if self.m > 1024 * 1024 || self.t > 16 || self.p > 8 {
            return Err(Error::Invalid("unsupported key derivation settings".into()));
        }
        Params::new(self.m, self.t, self.p, Some(KEY_LEN))
            .map_err(|e| Error::Invalid(format!("invalid key derivation settings: {e}")))
    }
}

/// Derives a 256-bit key from `secret`. The secret is NFC-normalised first, so the same
/// password typed on different systems (composed or decomposed accents) gives the same key.
pub fn derive_key(
    secret: &str,
    salt: &[u8],
    params: KdfParams,
) -> Result<Zeroizing<[u8; KEY_LEN]>> {
    let normalised = Zeroizing::new(secret.nfc().collect::<String>());
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params.checked()?)
        .hash_password_into(normalised.as_bytes(), salt, key.as_mut())
        .map_err(|e| Error::Invalid(format!("key derivation failed: {e}")))?;
    Ok(key)
}

pub fn random_bytes<const N: usize>() -> Result<[u8; N]> {
    let mut out = [0u8; N];
    getrandom::fill(&mut out).map_err(|e| Error::Invalid(format!("no OS randomness: {e}")))?;
    Ok(out)
}

/// AES-256-GCM with a fresh random nonce. Returns (nonce, ciphertext with tag).
pub fn seal(
    key: &[u8; KEY_LEN],
    aad: &[u8],
    plaintext: &[u8],
) -> Result<([u8; NONCE_LEN], Vec<u8>)> {
    let nonce = random_bytes::<NONCE_LEN>()?;
    let cipher = Aes256Gcm::new(key.into());
    let ct = cipher
        .encrypt(
            &Nonce::from(nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| Error::Invalid("encryption failed".into()))?;
    Ok((nonce, ct))
}

/// The authentication check failed: wrong key, or the data or header was altered. The
/// two can't be told apart, by design.
#[derive(Debug, PartialEq, Eq)]
pub struct DecryptFailed;

pub fn open(
    key: &[u8; KEY_LEN],
    nonce: &[u8; NONCE_LEN],
    aad: &[u8],
    ciphertext: &[u8],
) -> std::result::Result<Zeroizing<Vec<u8>>, DecryptFailed> {
    let cipher = Aes256Gcm::new(key.into());
    cipher
        .decrypt(
            &Nonce::from(*nonce),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| DecryptFailed)
}

// ───────── protected export envelope (EXP-8) ─────────

const APP: &str = "life-db";
const KDF_ALG: &str = "argon2id";
const CIPHER_ALG: &str = "aes-256-gcm";

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct EnvelopeKdf {
    alg: String,
    m: u32,
    t: u32,
    p: u32,
    salt: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct EnvelopeCipher {
    alg: String,
    nonce: String,
}

/// `deny_unknown_fields` makes a plain export (which has `format`, not `protected`) fail
/// to parse at its second key, so telling the two apart is cheap.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    app: String,
    protected: u32,
    kdf: EnvelopeKdf,
    cipher: EnvelopeCipher,
    data: String,
}

/// Everything except `data`, serialised in a fixed field order: the associated data, so
/// changing any parameter makes decryption fail.
#[derive(Serialize)]
struct Header<'a> {
    app: &'a str,
    protected: u32,
    kdf: &'a EnvelopeKdf,
    cipher: &'a EnvelopeCipher,
}

impl Envelope {
    fn aad(&self) -> Result<Vec<u8>> {
        serde_json::to_vec(&Header {
            app: &self.app,
            protected: self.protected,
            kdf: &self.kdf,
            cipher: &self.cipher,
        })
        .map_err(|e| Error::Invalid(e.to_string()))
    }

    /// Parses `bytes` as a protected export, or None if it isn't one.
    pub fn parse(bytes: &[u8]) -> Option<Self> {
        serde_json::from_slice::<Self>(bytes)
            .ok()
            .filter(|e| e.app == APP && e.protected == 1)
    }

    /// Encrypts `plaintext` under `password`. Returns the envelope as JSON text.
    pub fn protect(plaintext: &[u8], password: &str, params: KdfParams) -> Result<String> {
        if password.chars().count() < MIN_PASSWORD_CHARS {
            return Err(Error::Invalid(format!(
                "The password must be at least {MIN_PASSWORD_CHARS} characters."
            )));
        }
        let salt = random_bytes::<SALT_LEN>()?;
        let key = derive_key(password, &salt, params)?;
        let mut env = Self {
            app: APP.into(),
            protected: 1,
            kdf: EnvelopeKdf {
                alg: KDF_ALG.into(),
                m: params.m,
                t: params.t,
                p: params.p,
                salt: B64.encode(salt),
            },
            // The nonce is part of the header, so it is chosen before sealing.
            cipher: EnvelopeCipher {
                alg: CIPHER_ALG.into(),
                nonce: B64.encode(random_bytes::<NONCE_LEN>()?),
            },
            data: String::new(),
        };
        let nonce: [u8; NONCE_LEN] = decode_fixed(&env.cipher.nonce)?;
        let key: &[u8; KEY_LEN] = &key;
        let ct = Aes256Gcm::new(key.into())
            .encrypt(
                &Nonce::from(nonce),
                Payload {
                    msg: plaintext,
                    aad: &env.aad()?,
                },
            )
            .map_err(|_| Error::Invalid("encryption failed".into()))?;
        env.data = B64.encode(ct);
        serde_json::to_string_pretty(&env).map_err(|e| Error::Invalid(e.to_string()))
    }

    /// Decrypts with `password`. `Ok(None)` = wrong password or altered file.
    pub fn unprotect(&self, password: &str) -> Result<Option<Zeroizing<Vec<u8>>>> {
        if self.kdf.alg != KDF_ALG || self.cipher.alg != CIPHER_ALG {
            return Err(Error::Invalid(
                "This export uses encryption this version of Life DB doesn't know.".into(),
            ));
        }
        let params = KdfParams {
            m: self.kdf.m,
            t: self.kdf.t,
            p: self.kdf.p,
        };
        let salt: [u8; SALT_LEN] = decode_fixed(&self.kdf.salt)?;
        let nonce: [u8; NONCE_LEN] = decode_fixed(&self.cipher.nonce)?;
        let ct = B64
            .decode(&self.data)
            .map_err(|_| Error::Invalid("The protected export is damaged.".into()))?;
        let key = derive_key(password, &salt, params)?;
        Ok(open(&key, &nonce, &self.aad()?, &ct).ok())
    }
}

fn decode_fixed<const N: usize>(b64: &str) -> Result<[u8; N]> {
    B64.decode(b64)
        .ok()
        .and_then(|v| v.try_into().ok())
        .ok_or_else(|| Error::Invalid("The protected export is damaged.".into()))
}

/// Cheap parameters so tests run fast in debug builds.
#[cfg(test)]
pub(crate) const fn tests_fast() -> KdfParams {
    KdfParams {
        m: 1024,
        t: 1,
        p: 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FAST: KdfParams = tests_fast();
    const TEXT: &[u8] =
        br#"{"app":"life-db","format":1,"journalEntries":[{"body":"Swam in the sea"}]}"#;

    #[test]
    fn round_trip() {
        let sealed = Envelope::protect(TEXT, "correct horse", FAST).unwrap();
        assert!(!sealed.contains("Swam"), "plaintext must not be visible");
        let env = Envelope::parse(sealed.as_bytes()).expect("recognised as protected");
        assert_eq!(
            env.unprotect("correct horse").unwrap().unwrap().as_slice(),
            TEXT
        );
    }

    #[test]
    fn wrong_password_is_none() {
        let sealed = Envelope::protect(TEXT, "correct horse", FAST).unwrap();
        let env = Envelope::parse(sealed.as_bytes()).unwrap();
        assert!(env.unprotect("correct horsE").unwrap().is_none());
    }

    #[test]
    fn composed_and_decomposed_accents_are_the_same_password() {
        let sealed = Envelope::protect(TEXT, "caf\u{e9} au lait", FAST).unwrap();
        let env = Envelope::parse(sealed.as_bytes()).unwrap();
        assert!(env.unprotect("cafe\u{301} au lait").unwrap().is_some());
    }

    #[test]
    fn altered_header_or_data_fails_like_a_wrong_password() {
        let sealed = Envelope::protect(TEXT, "correct horse", FAST).unwrap();
        // Lower the cost in the header: the header is authenticated, so this must fail.
        let mut v: serde_json::Value = serde_json::from_str(&sealed).unwrap();
        v["kdf"]["t"] = 2.into();
        let env = Envelope::parse(v.to_string().as_bytes()).unwrap();
        assert!(env.unprotect("correct horse").unwrap().is_none());

        let mut v: serde_json::Value = serde_json::from_str(&sealed).unwrap();
        let mut data = B64.decode(v["data"].as_str().unwrap()).unwrap();
        data[0] ^= 1;
        v["data"] = B64.encode(data).into();
        let env = Envelope::parse(v.to_string().as_bytes()).unwrap();
        assert!(env.unprotect("correct horse").unwrap().is_none());
    }

    #[test]
    fn plain_exports_and_other_files_are_not_envelopes() {
        assert!(Envelope::parse(TEXT).is_none());
        assert!(Envelope::parse(b"not json").is_none());
        assert!(Envelope::parse(br#"{"app":"other","protected":1}"#).is_none());
    }

    #[test]
    fn short_passwords_and_absurd_costs_are_refused() {
        assert!(Envelope::protect(TEXT, "short", FAST).is_err());
        let sealed = Envelope::protect(TEXT, "correct horse", FAST).unwrap();
        let mut v: serde_json::Value = serde_json::from_str(&sealed).unwrap();
        v["kdf"]["m"] = (64 * 1024 * 1024).into(); // 64 GiB
        let env = Envelope::parse(v.to_string().as_bytes()).unwrap();
        assert!(env.unprotect("correct horse").is_err());
    }

    #[test]
    fn seal_and_open_with_associated_data() {
        let key = [7u8; KEY_LEN];
        let (nonce, ct) = seal(&key, b"lock v1 secret", b"device key").unwrap();
        assert_eq!(
            open(&key, &nonce, b"lock v1 secret", &ct)
                .unwrap()
                .as_slice(),
            b"device key"
        );
        assert_eq!(
            open(&key, &nonce, b"lock v1 recovery", &ct),
            Err(DecryptFailed)
        );
    }
}
