use crate::{
    commands::AppState,
    domain::{SlashCommandCatalogDto, TaskDto},
    error::AppError,
};
use tauri::{AppHandle, State};

#[tauri::command(rename_all = "camelCase")]
pub async fn list_slash_commands(
    project_id: String,
    force: Option<bool>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SlashCommandCatalogDto, AppError> {
    super::validate_id(&project_id)?;
    state
        .coordinator
        .list_slash_commands(&app, &project_id, force.unwrap_or(false))
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn set_task_model(
    task_id: String,
    model: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<TaskDto, AppError> {
    super::validate_id(&task_id)?;
    state
        .coordinator
        .set_task_model(&app, &task_id, &model)
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_task_permission_mode(
    task_id: String,
    mode: String,
    state: State<'_, AppState>,
) -> Result<TaskDto, AppError> {
    super::validate_id(&task_id)?;
    state.coordinator.set_task_permission_mode(&task_id, &mode)
}
