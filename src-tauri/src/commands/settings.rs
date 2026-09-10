use tauri::State;

use crate::{
    commands::AppState,
    error::AppError,
    settings::{SettingsPatch, SettingsView},
};

#[tauri::command]
pub fn get_claude_settings(state: State<'_, AppState>) -> Result<SettingsView, AppError> {
    state.settings.load()
}

#[tauri::command(rename_all = "camelCase")]
pub fn save_claude_settings(
    version: String,
    values: SettingsPatch,
    state: State<'_, AppState>,
) -> Result<SettingsView, AppError> {
    if let Some(base_url) = values.base_url.as_deref().filter(|value| !value.trim().is_empty()) {
        let valid = base_url.starts_with("https://") || base_url.starts_with("http://localhost") || base_url.starts_with("http://127.0.0.1");
        if !valid {
            return Err(AppError::new(
                "invalid_base_url",
                "Base URL 必须使用 HTTPS；本机调试可使用 localhost",
                true,
            ));
        }
    }
    state.settings.save(&version, values)
}
