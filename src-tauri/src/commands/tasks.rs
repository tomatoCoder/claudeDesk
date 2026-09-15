use crate::{
    commands::AppState,
    domain::{QueuedTurnDto, RunAccepted, TaskDto, TaskEvent, TurnSubmission, DEFAULT_TASK_TITLE},
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
        .create_task(&project_id, title.as_deref().unwrap_or(DEFAULT_TASK_TITLE))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rename_task(
    task_id: String,
    title: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<TaskDto, AppError> {
    super::validate_id(&task_id)?;
    let title = title.trim().to_string();
    crate::commands::sessions::rename_native_session(&app, state.inner(), &task_id, &title).await?;
    state.storage.rename_task(&task_id, &title)
}

#[tauri::command(rename_all = "camelCase")]
pub fn delete_task(task_id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    super::validate_id(&task_id)?;
    let task = state.storage.get_task(&task_id)?;
    if task.status.is_active() {
        return Err(AppError::new("task_active", "请先停止正在运行的会话", true));
    }
    if let Some(session_id) = task.claude_session_id.as_deref() {
        let home = dirs::home_dir().ok_or_else(|| AppError::new("home_not_found", "无法确定当前用户目录", false))?;
        crate::sessions::SessionDeletePlan::resolve(&home.join(".claude"), session_id)?.move_to_trash()?;
    }
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
pub fn submit_turn(
    task_id: String,
    prompt: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<TurnSubmission, AppError> {
    super::validate_id(&task_id)?;
    state.coordinator.submit_turn(app, task_id, prompt)
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_queued_turns(task_id: String, state: State<'_, AppState>) -> Result<Vec<QueuedTurnDto>, AppError> {
    super::validate_id(&task_id)?;
    state.coordinator.list_queued_turns(&task_id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn update_queued_turn(
    task_id: String,
    queued_turn_id: String,
    prompt: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<QueuedTurnDto, AppError> {
    super::validate_id(&task_id)?;
    super::validate_id(&queued_turn_id)?;
    state.coordinator.update_queued_turn(&app, &task_id, &queued_turn_id, prompt)
}

#[tauri::command(rename_all = "camelCase")]
pub fn delete_queued_turn(
    task_id: String,
    queued_turn_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    super::validate_id(&task_id)?;
    super::validate_id(&queued_turn_id)?;
    state.coordinator.delete_queued_turn(&app, &task_id, &queued_turn_id)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn adjust_queued_turn(
    task_id: String,
    queued_turn_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    super::validate_id(&task_id)?;
    super::validate_id(&queued_turn_id)?;
    state.coordinator.adjust_queued_turn(&app, &task_id, &queued_turn_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn send_queued_turn(
    task_id: String,
    queued_turn_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<RunAccepted, AppError> {
    super::validate_id(&task_id)?;
    super::validate_id(&queued_turn_id)?;
    state.coordinator.send_queued_turn(app, task_id, queued_turn_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub fn cancel_task(task_id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    super::validate_id(&task_id)?;
    state.coordinator.cancel(&task_id)
}
