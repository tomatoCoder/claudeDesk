use crate::{
    commands::AppState,
    domain::{ProjectFileEntry, ProjectFilePreview},
    error::AppError,
    files,
};
use std::path::Path;
use tauri::State;

#[tauri::command(rename_all = "camelCase")]
pub fn list_project_directory(
    project_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<Vec<ProjectFileEntry>, AppError> {
    super::validate_id(&project_id)?;
    let project = state.storage.get_project(&project_id)?;
    files::list_directory(Path::new(&project.path), &path)
}

#[tauri::command(rename_all = "camelCase")]
pub fn search_project_files(
    project_id: String,
    query: String,
    limit: usize,
    state: State<'_, AppState>,
) -> Result<Vec<ProjectFileEntry>, AppError> {
    super::validate_id(&project_id)?;
    let project = state.storage.get_project(&project_id)?;
    files::search_files(Path::new(&project.path), &query, limit)
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_project_file(
    project_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<ProjectFilePreview, AppError> {
    super::validate_id(&project_id)?;
    let project = state.storage.get_project(&project_id)?;
    files::read_preview(Path::new(&project.path), &path)
}

#[tauri::command(rename_all = "camelCase")]
pub fn write_project_file(
    project_id: String,
    path: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    super::validate_id(&project_id)?;
    let project = state.storage.get_project(&project_id)?;
    files::write_text_file(Path::new(&project.path), &path, &content)
}
