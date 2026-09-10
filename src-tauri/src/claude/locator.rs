use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};
use wait_timeout::ChildExt;

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
    if let Some(home) = dirs::home_dir() {
        result.extend(user_install_candidates(&home));
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

fn user_install_candidates(home: &Path) -> Vec<PathBuf> {
    let mut result = vec![
        home.join(".local").join("bin").join("claude"),
        home.join(".claude").join("local").join("claude"),
    ];
    #[cfg(windows)]
    result.push(home.join(".local").join("bin").join("claude.exe"));

    let node_versions = home.join(".nvm").join("versions").join("node");
    let mut versions = std::fs::read_dir(node_versions)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .collect::<Vec<_>>();
    versions.sort_by(|left, right| {
        let parse = |entry: &std::fs::DirEntry| {
            semver::Version::parse(entry.file_name().to_string_lossy().trim_start_matches('v'))
                .unwrap_or_else(|_| semver::Version::new(0, 0, 0))
        };
        parse(right).cmp(&parse(left))
    });
    result.extend(
        versions
            .into_iter()
            .map(|entry| entry.path().join("bin").join("claude")),
    );
    result
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

    let mut child = Command::new(&path)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            AppError::new(
                "cli_probe_failed",
                format!("无法运行 Claude Code：{error}"),
                true,
            )
        })?;
    let status = child.wait_timeout(Duration::from_secs(3))?.ok_or_else(|| {
        let _ = child.kill();
        let _ = child.wait();
        AppError::new("cli_probe_timeout", "Claude Code 版本检测超时", true)
    })?;
    let output = child.wait_with_output()?;
    if !status.success() {
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

    Ok(CliDiagnosticDto {
        status: CliDiagnosticStatus::Ready,
        path: Some(path.to_string_lossy().into()),
        version: Some(version.to_string()),
        message: "Claude Code 可执行文件已就绪".into(),
    })
}

fn is_executable(path: &Path) -> bool {
    path.is_file()
}

#[cfg(test)]
mod tests {
    use super::user_install_candidates;

    #[test]
    fn discovers_claude_installed_inside_an_nvm_node_version() {
        let home = tempfile::tempdir().unwrap();
        let expected = home
            .path()
            .join(".nvm/versions/node/v24.14.0/bin/claude");
        std::fs::create_dir_all(expected.parent().unwrap()).unwrap();
        std::fs::write(&expected, "fixture").unwrap();

        let candidates = user_install_candidates(home.path());

        assert!(candidates.contains(&expected));
    }
}
