use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::{
    bridge,
    claude::diagnose,
    commands::AppState,
    domain::{AppSnapshot, CliDiagnosticStatus},
    error::AppError,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeSession {
    session_id: String,
    title: String,
    last_modified: i64,
    cwd: Option<String>,
}

#[tauri::command]
pub async fn refresh_claude_sessions(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AppSnapshot, AppError> {
    let storage = state.storage.clone();
    let app_settings = storage.load_settings()?;
    let cli = diagnose(app_settings.claude_path.as_deref())?;
    if cli.status == CliDiagnosticStatus::Ready {
        let claude_path = cli.path.clone().ok_or_else(|| {
            AppError::new("cli_not_found", "未找到 Claude Code CLI", true)
        })?;
        let response = bridge::request(&app, &json!({
            "v": 1,
            "type": "catalog.list",
            "requestId": uuid::Uuid::new_v4().to_string(),
            "claudePath": claude_path,
        })).await?;
        let sessions: Vec<BridgeSession> = serde_json::from_value(
            response.get("sessions").cloned().unwrap_or_else(|| json!([]))
        ).map_err(|error| AppError::new("bridge_catalog_invalid", error.to_string(), true))?;
        for session in sessions {
            let Some(cwd) = session.cwd.map(std::path::PathBuf::from).filter(|path| path.is_dir()) else { continue };
            let name = cwd.file_name().and_then(|value| value.to_str()).filter(|value| !value.is_empty()).unwrap_or("Project");
            let project = storage.create_or_touch_project(name, &cwd)?;
            let updated_at = chrono::DateTime::from_timestamp_millis(session.last_modified)
                .unwrap_or_else(chrono::Utc::now)
                .to_rfc3339();
            storage.upsert_claude_session(&project.id, &session.session_id, &session.title, &updated_at)?;
        }
    }
    Ok(AppSnapshot {
        projects: storage.list_projects()?,
        tasks: storage.list_tasks()?,
        settings: app_settings,
        cli,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_claude_session_messages(
    task_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<Value>, AppError> {
    super::validate_id(&task_id)?;
    let storage = state.storage.clone();
    let task = storage.get_task(&task_id)?;
    let session_id = task.claude_session_id.ok_or_else(|| {
        AppError::new("session_not_started", "该会话尚未写入 Claude 历史记录", true)
    })?;
    let project = storage.get_project(&task.project_id)?;
    let settings = storage.load_settings()?;
    let cli = diagnose(settings.claude_path.as_deref())?;
    let claude_path = cli.path.ok_or_else(|| AppError::new("cli_not_found", "未找到 Claude Code CLI", true))?;
    let response = bridge::request(&app, &json!({
        "v": 1,
        "type": "catalog.messages",
        "requestId": uuid::Uuid::new_v4().to_string(),
        "claudePath": claude_path,
        "cwd": project.path,
        "sessionId": session_id,
    })).await?;
    Ok(response.get("messages").and_then(Value::as_array).cloned().unwrap_or_default())
}

pub async fn rename_native_session(
    app: &AppHandle,
    state: &AppState,
    task_id: &str,
    title: &str,
) -> Result<(), AppError> {
    let task = state.storage.get_task(task_id)?;
    let Some(session_id) = task.claude_session_id else { return Ok(()) };
    let project = state.storage.get_project(&task.project_id)?;
    let settings = state.storage.load_settings()?;
    let cli = diagnose(settings.claude_path.as_deref())?;
    let claude_path = cli.path.ok_or_else(|| AppError::new("cli_not_found", "未找到 Claude Code CLI", true))?;
    bridge::request(app, &json!({
        "v": 1,
        "type": "catalog.rename",
        "requestId": uuid::Uuid::new_v4().to_string(),
        "claudePath": claude_path,
        "cwd": project.path,
        "sessionId": session_id,
        "title": title,
    })).await?;
    Ok(())
}
