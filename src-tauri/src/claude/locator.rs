use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    process::Command,
};

use super::version::{parse_version, MINIMUM_CLAUDE_VERSION};
use crate::{
    domain::{CliDiagnosticDto, CliDiagnosticStatus},
    error::AppError,
};

pub fn candidates(custom: Option<&str>) -> Vec<PathBuf> {
    let mut result = Vec::new();
    if let Some(custom) = custom.map(str::trim).filter(|value| !value.is_empty()) {
        result.push(PathBuf::from(custom));
    }
    if let Ok(path) = which::which("claude") {
        result.push(path);
    }
    #[cfg(target_os = "macos")]
    result.extend([
        PathBuf::from("/opt/homebrew/bin/claude"),
        PathBuf::from("/usr/local/bin/claude"),
    ]);
    #[cfg(windows)]
    if let Some(data) = dirs::data_local_dir() {
        result.push(data.join("Programs").join("claude").join("claude.exe"));
    }
    let mut seen = HashSet::new();
    result
        .into_iter()
        .filter(|path| path.is_absolute() && seen.insert(path.clone()))
        .collect()
}

pub fn diagnose(custom: Option<&str>) -> Result<CliDiagnosticDto, AppError> {
    let candidates = candidates(custom);
    let Some(path) = candidates.into_iter().find(|path| is_executable(path)) else {
        return Ok(CliDiagnosticDto {
            status: CliDiagnosticStatus::NotFound,
            path: None,
            version: None,
            message: "未找到 Claude Code CLI，请先安装并登录".into(),
        });
    };

    let output = Command::new(&path)
        .arg("--version")
        .output()
        .map_err(|error| {
            AppError::new(
                "cli_probe_failed",
                format!("无法运行 Claude Code：{error}"),
                true,
            )
        })?;
    if !output.status.success() {
        return Ok(CliDiagnosticDto {
            status: CliDiagnosticStatus::ProbeFailed,
            path: Some(path.to_string_lossy().into()),
            version: None,
            message: "Claude Code 版本检查失败".into(),
        });
    }
    let version_text = String::from_utf8_lossy(&output.stdout);
    let version = parse_version(&version_text)?;
    if version < MINIMUM_CLAUDE_VERSION {
        return Ok(CliDiagnosticDto {
            status: CliDiagnosticStatus::TooOld,
            path: Some(path.to_string_lossy().into()),
            version: Some(version.to_string()),
            message: format!("Claude Code 版本过旧，需要至少 {MINIMUM_CLAUDE_VERSION}"),
        });
    }

    let auth = Command::new(&path)
        .args(["auth", "status"])
        .output()
        .map_err(|error| {
            AppError::new(
                "cli_probe_failed",
                format!("Claude 登录状态检查失败：{error}"),
                true,
            )
        })?;
    if !auth.status.success() {
        return Ok(CliDiagnosticDto {
            status: CliDiagnosticStatus::NotAuthenticated,
            path: Some(path.to_string_lossy().into()),
            version: Some(version.to_string()),
            message: "Claude Code 尚未登录，请在终端运行 claude 并完成登录".into(),
        });
    }
    Ok(CliDiagnosticDto {
        status: CliDiagnosticStatus::Ready,
        path: Some(path.to_string_lossy().into()),
        version: Some(version.to_string()),
        message: "Claude Code 已就绪".into(),
    })
}

fn is_executable(path: &Path) -> bool {
    path.is_file()
}
