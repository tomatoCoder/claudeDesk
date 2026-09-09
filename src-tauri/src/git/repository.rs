use crate::{
    domain::{GitFileStatus, WorkspaceDiff},
    error::AppError,
};
use std::{path::Path, process::Command};

const MAX_PATCH_BYTES: usize = 2 * 1024 * 1024;

pub fn workspace_diff(path: &Path) -> Result<WorkspaceDiff, AppError> {
    if !path.is_absolute() || !path.is_dir() {
        return Err(AppError::new(
            "invalid_project_path",
            "项目目录不可访问",
            true,
        ));
    }
    let inside = Command::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .current_dir(path)
        .output();
    if !inside.as_ref().is_ok_and(|output| output.status.success()) {
        return Ok(WorkspaceDiff {
            is_repository: false,
            branch: None,
            files: vec![],
            patch: String::new(),
            truncated: false,
        });
    }
    let branch = run_git(path, &["branch", "--show-current"])
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let status = run_git(path, &["status", "--porcelain=v1", "-z"])?;
    let files = status
        .split('\0')
        .filter(|entry| entry.len() >= 4)
        .map(|entry| {
            let code = &entry[..2];
            GitFileStatus {
                path: entry[3..].to_string(),
                status: code.trim().to_string(),
                staged: code.as_bytes()[0] != b' ' && code.as_bytes()[0] != b'?',
            }
        })
        .collect();
    let mut patch = run_git(
        path,
        &[
            "diff",
            "--no-ext-diff",
            "--src-prefix=a/",
            "--dst-prefix=b/",
        ],
    )?;
    let staged = run_git(
        path,
        &[
            "diff",
            "--cached",
            "--no-ext-diff",
            "--src-prefix=a/",
            "--dst-prefix=b/",
        ],
    )?;
    if !staged.is_empty() {
        patch.push_str("\n# Staged changes\n");
        patch.push_str(&staged);
    }
    let truncated = patch.len() > MAX_PATCH_BYTES;
    if truncated {
        patch.truncate(MAX_PATCH_BYTES);
        patch.push_str("\n\n… diff 已截断 …\n");
    }
    Ok(WorkspaceDiff {
        is_repository: true,
        branch,
        files,
        patch,
        truncated,
    })
}

fn run_git(path: &Path, args: &[&str]) -> Result<String, AppError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(path)
        .output()
        .map_err(|error| {
            AppError::new("git_unavailable", format!("无法运行 Git：{error}"), true)
        })?;
    if !output.status.success() {
        return Err(AppError::new(
            "git_command_failed",
            String::from_utf8_lossy(&output.stderr).trim(),
            true,
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}
