pub mod bridge;
pub mod claude;
pub mod commands;
pub mod diagnostics;
pub mod domain;
pub mod error;
pub mod permission;
pub mod process;
pub mod sessions;
pub mod settings;
pub mod storage;
pub mod task;

use commands::AppState;
use tauri::{Emitter, Manager, WindowEvent};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let storage = storage::Storage::open(data_dir.join("claude-desk.db"))?;
            storage.recover_interrupted_tasks()?;
            let logs = diagnostics::LogStore::new(data_dir.join("logs"))?;
            let settings = settings::SettingsRepository::user_default()?;
            let permissions = permission::PermissionHub::default();
            let coordinator = task::TaskCoordinator::new(
                storage.clone(),
                logs.clone(),
                permissions.clone(),
                settings.clone(),
            );
            app.manage(AppState {
                storage,
                coordinator,
                permissions,
                logs,
                settings,
            });
            let app_handle = app.handle().clone();
            let main_window = app
                .get_webview_window("main")
                .ok_or_else(|| std::io::Error::other("missing main window"))?;
            main_window.on_window_event(move |event| {
                if !matches!(event, WindowEvent::CloseRequested { .. }) {
                    return;
                }
                let state = app_handle.state::<AppState>();
                let active_task_ids = state.coordinator.active_task_ids();
                if active_task_ids.is_empty() {
                    return;
                }
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                }
                let _ = app_handle.emit("app-exit-requested", active_task_ids);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::application::confirm_app_exit,
            commands::drag::read_drag_file_paths,
            commands::projects::get_snapshot,
            commands::projects::add_project,
            commands::projects::remove_project,
            commands::projects::open_project,
            commands::projects::save_settings,
            commands::sessions::refresh_claude_sessions,
            commands::sessions::get_claude_session_messages,
            commands::settings::get_claude_settings,
            commands::settings::save_claude_settings,
            commands::settings::save_claude_settings_json,
            commands::tasks::create_task,
            commands::tasks::rename_task,
            commands::tasks::delete_task,
            commands::tasks::list_task_events,
            commands::tasks::send_turn,
            commands::tasks::submit_turn,
            commands::tasks::list_queued_turns,
            commands::tasks::update_queued_turn,
            commands::tasks::delete_queued_turn,
            commands::tasks::adjust_queued_turn,
            commands::tasks::send_queued_turn,
            commands::tasks::cancel_task,
            commands::permissions::resolve_permission,
            commands::slash_commands::list_slash_commands,
            commands::slash_commands::set_task_model,
            commands::slash_commands::set_task_permission_mode,
            commands::diagnostics::diagnose_claude,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Claude Desk");
}
