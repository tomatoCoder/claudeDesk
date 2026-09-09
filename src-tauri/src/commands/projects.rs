use crate::{
    claude::diagnose,
    commands::AppState,
    domain::{AppSettingsDto, AppSnapshot, ProjectDto},
    error::AppError,
};
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub fn get_snapshot(state: State<'_, AppState>) -> Result<AppSnapshot, AppError> {
    let settings = state.storage.load_settings()?;
    Ok(AppSnapshot {
        projects: state.storage.list_projects()?,
        tasks: state.storage.list_tasks()?,
        cli: diagnose(settings.claude_path.as_deref())?,
        settings,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn add_project(path: String, state: State<'_, AppState>) -> Result<ProjectDto, AppError> {
    let path = PathBuf::from(path);
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("Project")
        .to_string();
    state.storage.create_or_touch_project(&name, &path)
}

#[tauri::command(rename_all = "camelCase")]
pub fn remove_project(project_id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    super::validate_id(&project_id)?;
    if state
        .storage
        .list_project_tasks(&project_id)?
        .iter()
        .any(|task| task.status.is_active())
    {
        return Err(AppError::new(
            "project_has_active_tasks",
            "项目仍有正在运行的任务",
            true,
        ));
    }
    state.storage.remove_project(&project_id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn save_settings(
    settings: AppSettingsDto,
    state: State<'_, AppState>,
) -> Result<AppSettingsDto, AppError> {
    if let Some(path) = settings.claude_path.as_deref() {
        let path = PathBuf::from(path);
        if !path.is_absolute() {
            return Err(AppError::new(
                "invalid_cli_path",
                "Claude 路径必须是绝对路径",
                true,
            ));
        }
    }
    state.storage.save_settings(&settings)
}
