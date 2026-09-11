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
    if let Some(base_url) = values
        .base_url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let valid = base_url.starts_with("https://")
            || base_url.starts_with("http://localhost")
            || base_url.starts_with("http://127.0.0.1");
        if !valid {
            return Err(AppError::new(
                "invalid_base_url",
                "Base URL 必须使用 HTTPS；本机调试可使用 localhost",
                true,
            ));
        }
    }
    if let Some(threshold) = values
        .auto_compact_threshold
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let valid = threshold
            .parse::<u8>()
            .is_ok_and(|value| (1..=100).contains(&value));
        if !valid {
            return Err(AppError::new(
                "invalid_auto_compact_threshold",
                "自动压缩阈值必须是 1–100 之间的整数",
                true,
            ));
        }
    }
    if let Some(window) = values
        .auto_compact_window
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let valid = window
            .parse::<u32>()
            .is_ok_and(|value| (100_000..=1_000_000).contains(&value));
        if !valid {
            return Err(AppError::new(
                "invalid_auto_compact_window",
                "上下文窗口必须是 100000–1000000 之间的整数",
                true,
            ));
        }
    }
    state.settings.save(&version, values)
}

#[tauri::command(rename_all = "camelCase")]
pub fn save_claude_settings_json(
    version: String,
    raw: String,
    state: State<'_, AppState>,
) -> Result<SettingsView, AppError> {
    state.settings.save_raw(&version, &raw)
}
