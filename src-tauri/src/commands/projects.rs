use crate::{
    claude::diagnose,
    commands::AppState,
    domain::{AppSettingsDto, AppSnapshot, ProjectDto, ProjectOpenWith, TerminalApp},
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

#[tauri::command(rename_all = "camelCase")]
pub fn open_terminal(project_id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    super::validate_id(&project_id)?;
    let project = state.storage.get_project(&project_id)?;
    let path = Path::new(&project.path);
    if !path.is_dir() {
        return Err(AppError::new(
            "project_path_missing",
            "项目目录不存在",
            true,
        ));
    }
    let settings = state.storage.load_settings()?;
    open_terminal_at(path, &settings.terminal_app)
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

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn run_spawn_command(mut command: Command, label: &str) -> Result<(), AppError> {
    command.spawn().map(|_| ()).map_err(|error| {
        AppError::new(
            "terminal_open_failed",
            format!("无法启动 {label}：{error}"),
            true,
        )
    })
}

/// Unix shell 单引号转义：嵌入 `osascript`/`sh -c` 脚本时保证路径安全。
#[cfg(unix)]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

#[cfg(target_os = "macos")]
fn open_terminal_at(path: &Path, app: &TerminalApp) -> Result<(), AppError> {
    match app {
        TerminalApp::Iterm => {
            let mut command = Command::new("open");
            command.args(["-a", "iTerm"]).arg(path);
            run_open_command(command, "iTerm2")
        }
        // Terminal.app 无法通过 `open -a Terminal <path>` 设置工作目录，改用 AppleScript。
        _ => {
            let script = format!(
                "tell application \"Terminal\" to do script \"cd {}\"",
                shell_quote(&path.to_string_lossy())
            );
            let mut command = Command::new("osascript");
            command.arg("-e").arg(script);
            run_open_command(command, "Terminal")
        }
    }
}

#[cfg(target_os = "windows")]
fn open_terminal_at(path: &Path, app: &TerminalApp) -> Result<(), AppError> {
    let path_text = path.to_string_lossy().into_owned();
    let open_windows_terminal = || {
        let mut command = Command::new("wt");
        command.arg("-d").arg(path_text.as_str());
        run_spawn_command(command, "Windows Terminal")
    };
    let open_command_prompt = || {
        let mut command = Command::new("cmd");
        command.current_dir(path).args(["/C", "start", "cmd"]);
        run_spawn_command(command, "Command Prompt")
    };
    match app {
        TerminalApp::WindowsTerminal => open_windows_terminal(),
        TerminalApp::CommandPrompt => open_command_prompt(),
        TerminalApp::Powershell => {
            let location = format!(
                "Set-Location -LiteralPath {}",
                format!("'{}'", path_text.replace('\'', "''"))
            );
            let mut command = Command::new("powershell");
            command.args(["-NoExit", "-Command"]).arg(location);
            run_spawn_command(command, "PowerShell")
        }
        // 其他平台专属选项回退：优先 Windows Terminal，失败再用 Command Prompt。
        _ => open_windows_terminal().or_else(|_| open_command_prompt()),
    }
}

#[cfg(target_os = "linux")]
fn open_terminal_at(path: &Path, app: &TerminalApp) -> Result<(), AppError> {
    let path_text = path.to_string_lossy().into_owned();
    let mut candidates: Vec<(Command, &str)> = Vec::new();
    let mut push = |program: &str, args: Vec<String>, label: &str| {
        let mut command = Command::new(program);
        command.args(args);
        candidates.push((command, label));
    };
    match app {
        TerminalApp::GnomeTerminal => push(
            "gnome-terminal",
            vec![format!("--working-directory={path_text}")],
            "GNOME Terminal",
        ),
        TerminalApp::Konsole => {
            push("konsole", vec!["--workdir".into(), path_text.clone()], "Konsole")
        }
        TerminalApp::Alacritty => push(
            "alacritty",
            vec!["--working-directory".into(), path_text.clone()],
            "Alacritty",
        ),
        TerminalApp::Kitty => {
            push("kitty", vec!["--directory".into(), path_text.clone()], "Kitty")
        }
        TerminalApp::Xterm => push(
            "xterm",
            vec![
                "-e".into(),
                "sh".into(),
                "-c".into(),
                format!("cd {} && exec bash", shell_quote(&path_text)),
            ],
            "XTerm",
        ),
        // 默认按桌面环境常见顺序探测可用终端。
        TerminalApp::Default => {
            push(
                "x-terminal-emulator",
                vec![format!("--working-directory={path_text}")],
                "x-terminal-emulator",
            );
            push(
                "gnome-terminal",
                vec![format!("--working-directory={path_text}")],
                "GNOME Terminal",
            );
            push(
                "konsole",
                vec!["--workdir".into(), path_text.clone()],
                "Konsole",
            );
            push(
                "xfce4-terminal",
                vec![format!("--working-directory={path_text}")],
                "Xfce Terminal",
            );
            push(
                "alacritty",
                vec!["--working-directory".into(), path_text.clone()],
                "Alacritty",
            );
            push(
                "kitty",
                vec!["--directory".into(), path_text.clone()],
                "Kitty",
            );
            push(
                "xterm",
                vec![
                    "-e".into(),
                    "sh".into(),
                    "-c".into(),
                    format!("cd {} && exec bash", shell_quote(&path_text)),
                ],
                "XTerm",
            );
        }
        // 其他平台专属选项在 Linux 上按默认探测处理。
        _ => {
            push(
                "x-terminal-emulator",
                vec![format!("--working-directory={path_text}")],
                "x-terminal-emulator",
            );
            push(
                "gnome-terminal",
                vec![format!("--working-directory={path_text}")],
                "GNOME Terminal",
            );
            push(
                "xterm",
                vec![
                    "-e".into(),
                    "sh".into(),
                    "-c".into(),
                    format!("cd {} && exec bash", shell_quote(&path_text)),
                ],
                "XTerm",
            );
        }
    }
    let mut last_error = None;
    for (mut command, label) in candidates {
        match command.spawn() {
            Ok(_) => return Ok(()),
            Err(error) => last_error = Some((label.to_string(), error)),
        }
    }
    Err(match last_error {
        Some((label, error)) => AppError::new(
            "terminal_open_failed",
            format!("无法启动 {label}：{error}"),
            true,
        ),
        None => AppError::new("terminal_not_found", "未找到可用的终端", true),
    })
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
