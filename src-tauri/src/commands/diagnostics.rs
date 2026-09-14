use crate::{claude::diagnose, commands::AppState, domain::CliDiagnosticDto, error::AppError};
use tauri::State;
use tokio::process::Command;

#[tauri::command]
pub fn diagnose_claude(state: State<'_, AppState>) -> Result<CliDiagnosticDto, AppError> {
    let settings = state.storage.load_settings()?;
    diagnose(settings.claude_path.as_deref())
}

#[tauri::command]
pub async fn upgrade_claude(state: State<'_, AppState>) -> Result<CliDiagnosticDto, AppError> {
    let settings = state.storage.load_settings()?;
    let diagnostic = diagnose(settings.claude_path.as_deref())?;
    let path = diagnostic
        .path
        .ok_or_else(|| AppError::new("cli_not_found", "未找到可升级的 Claude Code CLI", true))?;
    let output = Command::new(path)
        .arg("update")
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|error| {
            AppError::new("cli_upgrade_failed", format!("无法启动升级：{error}"), true)
        })?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(if output.stderr.is_empty() {
            &output.stdout
        } else {
            &output.stderr
        });
        let detail = detail.trim();
        return Err(AppError::new(
            "cli_upgrade_failed",
            if detail.is_empty() {
                "Claude Code 升级失败，请稍后重试".into()
            } else {
                format!("Claude Code 升级失败：{detail}")
            },
            true,
        ));
    }
    diagnose(settings.claude_path.as_deref())
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_raw_log(task_id: String, state: State<'_, AppState>) -> Result<String, AppError> {
    super::validate_id(&task_id)?;
    state.logs.read(&task_id)
}
