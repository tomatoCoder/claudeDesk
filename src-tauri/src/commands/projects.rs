use crate::{
    claude::diagnose,
    commands::AppState,
    domain::{AppSettingsDto, AppSnapshot, ProjectDto, ProjectOpenWith},
    error::AppError,
};
use std::{
    path::{Path, PathBuf},
    process::Command,
};
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
pub fn open_project(project_id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    super::validate_id(&project_id)?;
    let project = state.storage.get_project(&project_id)?;
    let settings = state.storage.load_settings()?;
    open_project_path(Path::new(&project.path), &settings.open_with)
}

fn run_open_command(mut command: Command, label: &str) -> Result<(), AppError> {
    let status = command.status().map_err(|error| {
        AppError::new(
            "project_opener_not_found",
            format!("无法启动 {label}：{error}"),
            true,
        )
    })?;
    if status.success() {
        Ok(())
    } else {
        Err(AppError::new(
            "project_open_failed",
            format!("{label} 无法打开项目，请确认应用已安装"),
            true,
        ))
    }
}

#[cfg(target_os = "macos")]
fn open_project_path(path: &Path, open_with: &ProjectOpenWith) -> Result<(), AppError> {
    let (application, label) = match open_with {
        ProjectOpenWith::Default => (None, "系统默认应用"),
        ProjectOpenWith::Qoder => (
            Some(
                find_macos_application(&["Qoder IDE.app", "Qoder.app"])
                    .unwrap_or_else(|| PathBuf::from("Qoder IDE")),
            ),
            "Qoder",
        ),
        ProjectOpenWith::Vscode => (
            Some(
                find_macos_application(&["Visual Studio Code.app", "Visual Studio Code 2.app"])
                    .unwrap_or_else(|| PathBuf::from("Visual Studio Code")),
            ),
            "VS Code",
        ),
        ProjectOpenWith::IntellijIdea => (
            Some(
                find_macos_application(&["IntelliJ IDEA.app", "IntelliJ IDEA CE.app"])
                    .unwrap_or_else(|| PathBuf::from("IntelliJ IDEA")),
            ),
            "IntelliJ IDEA",
        ),
    };
    let mut command = Command::new("open");
    if let Some(application) = application {
        command.arg("-a").arg(application);
    }
    command.arg(path);
    run_open_command(command, label)
}

#[cfg(target_os = "macos")]
fn find_macos_application(names: &[&str]) -> Option<PathBuf> {
    let mut roots = vec![PathBuf::from("/Applications")];
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join("Applications"));
    }
    roots
        .iter()
        .flat_map(|root| names.iter().map(move |name| root.join(name)))
        .find(|candidate| candidate.is_dir())
}

#[cfg(target_os = "windows")]
fn open_project_path(path: &Path, open_with: &ProjectOpenWith) -> Result<(), AppError> {
    let (executable, label) = match open_with {
        ProjectOpenWith::Default => ("explorer", "系统默认应用"),
        ProjectOpenWith::Qoder => ("qoder", "Qoder"),
        ProjectOpenWith::Vscode => ("code", "VS Code"),
        ProjectOpenWith::IntellijIdea => ("idea64", "IntelliJ IDEA"),
    };
    let mut command = Command::new(executable);
    command.arg(path);
    run_open_command(command, label)
}

#[cfg(target_os = "linux")]
fn open_project_path(path: &Path, open_with: &ProjectOpenWith) -> Result<(), AppError> {
    let (executable, label) = match open_with {
        ProjectOpenWith::Default => ("xdg-open", "系统默认应用"),
        ProjectOpenWith::Qoder => ("qoder", "Qoder"),
        ProjectOpenWith::Vscode => ("code", "VS Code"),
        ProjectOpenWith::IntellijIdea => ("idea", "IntelliJ IDEA"),
    };
    let mut command = Command::new(executable);
    command.arg(path);
    run_open_command(command, label)
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
