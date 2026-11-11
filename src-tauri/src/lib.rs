mod commands;

use life_db_core::keystore::OsKeyStore;
use tauri::Manager;

/// Keyring service/account for the device key (SEC-2).
const KEYRING_SERVICE: &str = "life-db";
const KEYRING_ACCOUNT: &str = "device-key";

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let store = OsKeyStore::new(KEYRING_SERVICE, KEYRING_ACCOUNT);
            let opened = life_db_core::open_app_database(&data_dir, &store);
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Life DB");
}
