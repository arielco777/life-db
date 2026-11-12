mod commands;

use life_db_core::DbStatus;
use life_db_core::keystore::OsKeyStore;
use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

/// Keyring service/account for the device key (SEC-2).
const KEYRING_SERVICE: &str = "life-db";
const KEYRING_ACCOUNT: &str = "device-key";

/// `<app log dir>/life-db.log`, rotated at 1 MB keeping 5 old files (DIST-6).
pub const LOG_FILE_STEM: &str = "life-db";

/// Errors, warnings and app events only. Nothing logged may contain user content (SEC-3):
/// no SQL parameters, journal text or habit names.
fn log_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_log::Builder::new()
        .clear_targets()
        .target(Target::new(TargetKind::LogDir {
            file_name: Some(LOG_FILE_STEM.into()),
        }))
        .target(Target::new(TargetKind::Stdout))
        .level(log::LevelFilter::Info)
        .max_file_size(1_000_000)
        .rotation_strategy(RotationStrategy::KeepSome(5))
        .build()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(log_plugin())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            log::info!("Life DB {} starting", app.package_info().version);
            let data_dir = app.path().app_data_dir()?;
            let store = OsKeyStore::new(KEYRING_SERVICE, KEYRING_ACCOUNT);
            let opened = life_db_core::open_app_database(&data_dir, &store);
            match &opened.status {
                DbStatus::Open {
                    created_now,
                    key_fallback,
                    ..
                } => log::info!("database open (new: {created_now}, key in file: {key_fallback})"),
                DbStatus::KeyMissing { .. } => log::error!("database key missing"),
                DbStatus::Error { message } => log::error!("database failed to open: {message}"),
            }
            app.manage(commands::AppDb::new(opened, data_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::db_status,
            commands::db_query,
            commands::db_execute,
            commands::db_transaction,
            commands::db_run_script,
            commands::db_backup,
            commands::db_backup_internal,
            commands::db_auto_backup,
            commands::db_restore,
            commands::db_info,
            commands::app_log_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Life DB");
}
