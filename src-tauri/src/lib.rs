pub mod claude;
pub mod commands;
pub mod diagnostics;
pub mod domain;
pub mod error;
pub mod git;
pub mod permission;
pub mod process;
pub mod storage;
pub mod task;

use commands::AppState;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let storage = storage::Storage::open(data_dir.join("claude-desk.db"))?;
            storage.recover_interrupted_tasks()?;
            let logs = diagnostics::LogStore::new(data_dir.join("logs"))?;
            let permissions = permission::PermissionHub::default();
            let coordinator =
                task::TaskCoordinator::new(storage.clone(), logs.clone(), permissions.clone());
            app.manage(AppState {
                storage,
                coordinator,
                permissions,
                logs,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::projects::get_snapshot,
            commands::projects::add_project,
            commands::projects::remove_project,
            commands::projects::save_settings,
            commands::tasks::create_task,
            commands::tasks::rename_task,
            commands::tasks::delete_task,
            commands::tasks::list_task_events,
            commands::tasks::send_turn,
            commands::tasks::cancel_task,
            commands::permissions::resolve_permission,
            commands::git::get_workspace_diff,
            commands::diagnostics::diagnose_claude,
            commands::diagnostics::read_raw_log,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Claude Desk");
}
