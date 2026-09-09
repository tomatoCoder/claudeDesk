use crate::{claude::diagnose, commands::AppState, domain::CliDiagnosticDto, error::AppError};
use tauri::State;

#[tauri::command]
pub fn diagnose_claude(state: State<'_, AppState>) -> Result<CliDiagnosticDto, AppError> {
    let settings = state.storage.load_settings()?;
    diagnose(settings.claude_path.as_deref())
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_raw_log(task_id: String, state: State<'_, AppState>) -> Result<String, AppError> {
    super::validate_id(&task_id)?;
    state.logs.read(&task_id)
}
