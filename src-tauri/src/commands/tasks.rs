use crate::{
    commands::AppState,
    domain::{RunAccepted, TaskDto, TaskEvent},
    error::AppError,
};
use tauri::{AppHandle, State};

#[tauri::command(rename_all = "camelCase")]
pub fn create_task(
    project_id: String,
    title: Option<String>,
    state: State<'_, AppState>,
) -> Result<TaskDto, AppError> {
    super::validate_id(&project_id)?;
    state
        .storage
        .create_task(&project_id, title.as_deref().unwrap_or("新任务"))
}

#[tauri::command(rename_all = "camelCase")]
pub fn rename_task(
    task_id: String,
    title: String,
    state: State<'_, AppState>,
) -> Result<TaskDto, AppError> {
    super::validate_id(&task_id)?;
    state.storage.rename_task(&task_id, &title)
}

#[tauri::command(rename_all = "camelCase")]
pub fn delete_task(task_id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    super::validate_id(&task_id)?;
    state.storage.delete_task(&task_id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_task_events(
    task_id: String,
    offset: Option<u64>,
    limit: Option<u64>,
    state: State<'_, AppState>,
) -> Result<Vec<TaskEvent>, AppError> {
    super::validate_id(&task_id)?;
    state
        .storage
        .list_events(&task_id, offset.unwrap_or(0), limit.unwrap_or(5000))
}

#[tauri::command(rename_all = "camelCase")]
pub fn send_turn(
    task_id: String,
    prompt: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<RunAccepted, AppError> {
    super::validate_id(&task_id)?;
    state.coordinator.send_turn(app, task_id, prompt)
}

#[tauri::command(rename_all = "camelCase")]
pub fn cancel_task(task_id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    super::validate_id(&task_id)?;
    state.coordinator.cancel(&task_id)
}
