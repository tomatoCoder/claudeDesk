use std::{fs, path::{Path, PathBuf}};

use crate::error::AppError;

#[derive(Debug)]
pub struct SessionDeletePlan {
    targets: Vec<PathBuf>,
}

impl SessionDeletePlan {
    pub fn resolve(claude_root: &Path, session_id: &str) -> Result<Self, AppError> {
        uuid::Uuid::parse_str(session_id).map_err(|_| {
            AppError::new("invalid_session_id", "会话标识必须是完整 UUID", false)
        })?;
        let root = claude_root.canonicalize().map_err(|_| {
            AppError::new("claude_data_not_found", "Claude 数据目录不存在", true)
        })?;
        let projects = root.join("projects");
        if !projects.is_dir() {
            return Ok(Self { targets: Vec::new() });
        }
        let mut targets = Vec::new();
        for project in fs::read_dir(&projects)? {
            let project = project?.path();
            if !project.is_dir() { continue }
            for candidate in [project.join(session_id), project.join(format!("{session_id}.jsonl"))] {
                if !candidate.exists() { continue }
                let canonical = candidate.canonicalize()?;
                if !canonical.starts_with(&root) {
                    return Err(AppError::new(
                        "unsafe_session_target",
                        "拒绝删除 Claude 数据目录外的目标",
                        false,
                    ));
                }
                targets.push(canonical);
            }
        }
        targets.sort();
        targets.dedup();
        Ok(Self { targets })
    }

    pub fn targets(&self) -> &[PathBuf] {
        &self.targets
    }

    pub fn move_to_trash(&self) -> Result<(), AppError> {
        let mut failures = Vec::new();
        for target in &self.targets {
            if let Err(error) = trash::delete(target) {
                failures.push(format!("{}: {error}", target.display()));
            }
        }
        if failures.is_empty() {
            Ok(())
        } else {
            Err(AppError::new(
                "session_trash_partial_failure",
                format!("部分会话数据无法移入废纸篓：{}", failures.join("；")),
                true,
            ))
        }
    }
}
