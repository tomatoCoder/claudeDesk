use crate::{commands::AppState, domain::WorkspaceDiff, error::AppError};
use std::path::Path;
use tauri::State;

#[tauri::command(rename_all = "camelCase")]
pub fn get_workspace_diff(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<WorkspaceDiff, AppError> {
    super::validate_id(&project_id)?;
    let project = state.storage.get_project(&project_id)?;
    crate::git::workspace_diff(Path::new(&project.path))
}
