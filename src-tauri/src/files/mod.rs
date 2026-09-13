use crate::{
    domain::{ProjectFileEntry, ProjectFileKind, ProjectFilePreview, ProjectFilePreviewKind},
    error::AppError,
};
use std::{
    path::{Component, Path, PathBuf},
    process::Command,
};

const MAX_PREVIEW_BYTES: u64 = 2 * 1024 * 1024;
const MAX_SEARCH_RESULTS: usize = 200;
const MAX_FALLBACK_FILES: usize = 50_000;
const FALLBACK_SKIPPED_DIRECTORIES: [&str; 4] = [".git", "node_modules", "target", "dist"];

pub fn list_directory(root: &Path, relative: &str) -> Result<Vec<ProjectFileEntry>, AppError> {
    let root = canonical_root(root)?;
    let target = resolve_relative(&root, relative, true)?;
    if !target.is_dir() {
        return Err(AppError::new("not_a_directory", "所选路径不是目录", true));
    }

    let mut entries = std::fs::read_dir(&target)?
        .filter_map(Result::ok)
        .filter_map(|entry| entry_from_path(&root, entry.path()).ok())
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| {
        kind_rank(&left.kind)
            .cmp(&kind_rank(&right.kind))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(entries)
}

pub fn read_preview(root: &Path, relative: &str) -> Result<ProjectFilePreview, AppError> {
    let root = canonical_root(root)?;
    let target = resolve_relative(&root, relative, false)?;
    if !target.is_file() {
        return Err(AppError::new("not_a_file", "所选路径不是文件", true));
    }

    let metadata = std::fs::metadata(&target)?;
    let size = metadata.len();
    if size > MAX_PREVIEW_BYTES {
        return Ok(ProjectFilePreview {
            path: normalize_relative(&root, &target)?,
            kind: ProjectFilePreviewKind::TooLarge,
            mime_type: mime_type(&target).map(str::to_string),
            content: None,
            bytes: None,
            size,
        });
    }

    let bytes = std::fs::read(&target)?;
    if bytes.len() as u64 > MAX_PREVIEW_BYTES {
        return Ok(ProjectFilePreview {
            path: normalize_relative(&root, &target)?,
            kind: ProjectFilePreviewKind::TooLarge,
            mime_type: mime_type(&target).map(str::to_string),
            content: None,
            bytes: None,
            size: bytes.len() as u64,
        });
    }

    let path = normalize_relative(&root, &target)?;
    if let Some(mime_type) = mime_type(&target) {
        return Ok(ProjectFilePreview {
            path,
            kind: ProjectFilePreviewKind::Image,
            mime_type: Some(mime_type.to_string()),
            content: None,
            bytes: Some(bytes),
            size,
        });
    }

    if bytes.contains(&0) {
        return Ok(binary_preview(path, size));
    }
    match String::from_utf8(bytes) {
        Ok(content) => Ok(ProjectFilePreview {
            path,
            kind: ProjectFilePreviewKind::Text,
            mime_type: Some("text/plain".to_string()),
            content: Some(content),
            bytes: None,
            size,
        }),
        Err(_) => Ok(binary_preview(path, size)),
    }
}

pub fn write_text_file(root: &Path, relative: &str, content: &str) -> Result<(), AppError> {
    let root = canonical_root(root)?;
    let target = resolve_relative(&root, relative, false)?;
    if !target.is_file() {
        return Err(AppError::new("not_a_file", "所选路径不是文件", true));
    }
    if !matches!(
        read_preview(&root, relative)?.kind,
        ProjectFilePreviewKind::Text
    ) {
        return Err(AppError::new(
            "file_not_editable",
            "仅支持编辑文本文件",
            true,
        ));
    }
    std::fs::write(target, content)?;
    Ok(())
}

pub fn search_files(
    root: &Path,
    query: &str,
    limit: usize,
) -> Result<Vec<ProjectFileEntry>, AppError> {
    let root = canonical_root(root)?;
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let paths = git_files(&root).unwrap_or_else(|| fallback_files(&root));
    let mut matches = paths
        .into_iter()
        .filter_map(|relative| {
            let target = resolve_relative(&root, &relative, false).ok()?;
            target
                .is_file()
                .then(|| entry_from_path(&root, target))
                .transpose()
                .ok()
                .flatten()
        })
        .filter_map(|entry| {
            let path = entry.path.to_lowercase();
            path.contains(&query)
                .then(|| (search_rank(&entry, &query), entry))
        })
        .collect::<Vec<_>>();
    matches.sort_by(|(left_rank, left), (right_rank, right)| {
        left_rank
            .cmp(right_rank)
            .then_with(|| left.path.to_lowercase().cmp(&right.path.to_lowercase()))
    });
    Ok(matches
        .into_iter()
        .map(|(_, entry)| entry)
        .take(limit.clamp(1, MAX_SEARCH_RESULTS))
        .collect())
}

fn git_files(root: &Path) -> Option<Vec<String>> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args([
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(
        output
            .stdout
            .split(|byte| *byte == 0)
            .filter(|value| !value.is_empty())
            .filter_map(|value| String::from_utf8(value.to_vec()).ok())
            .collect(),
    )
}

fn fallback_files(root: &Path) -> Vec<String> {
    let mut pending = vec![root.to_path_buf()];
    let mut files = Vec::new();
    while let Some(directory) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(metadata) = path.symlink_metadata() else {
                continue;
            };
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                let name = entry.file_name();
                if !FALLBACK_SKIPPED_DIRECTORIES
                    .iter()
                    .any(|skipped| name == *skipped)
                {
                    pending.push(path);
                }
            } else if metadata.is_file() {
                if let Ok(relative) = normalize_relative(root, &path) {
                    files.push(relative);
                    if files.len() >= MAX_FALLBACK_FILES {
                        return files;
                    }
                }
            }
        }
    }
    files
}

fn search_rank(entry: &ProjectFileEntry, query: &str) -> (u8, usize) {
    let name = entry.name.to_lowercase();
    let rank = if name == query {
        0
    } else if name.starts_with(query) {
        1
    } else if name.contains(query) {
        2
    } else {
        3
    };
    (rank, name.len())
}

fn canonical_root(root: &Path) -> Result<PathBuf, AppError> {
    let root = root
        .canonicalize()
        .map_err(|_| AppError::new("invalid_project_path", "项目目录不存在或不可访问", true))?;
    if !root.is_dir() {
        return Err(AppError::new(
            "invalid_project_path",
            "项目目录不存在或不可访问",
            true,
        ));
    }
    Ok(root)
}

fn resolve_relative(root: &Path, relative: &str, allow_root: bool) -> Result<PathBuf, AppError> {
    let path = Path::new(relative);
    let valid = (allow_root || !relative.is_empty())
        && !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
        && relative != ".git"
        && !relative.starts_with(".git/")
        && !relative.starts_with(".git\\");
    if !valid {
        return Err(outside_error());
    }
    let target = root
        .join(path)
        .canonicalize()
        .map_err(|_| AppError::new("file_not_found", "文件或目录不存在", true))?;
    if !target.starts_with(root) {
        return Err(outside_error());
    }
    Ok(target)
}

fn entry_from_path(root: &Path, path: PathBuf) -> Result<ProjectFileEntry, AppError> {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::new("invalid_file_name", "文件名不是有效 UTF-8", true))?
        .to_string();
    let kind = if path.is_dir() {
        ProjectFileKind::Directory
    } else {
        ProjectFileKind::File
    };
    let extension = matches!(kind, ProjectFileKind::File)
        .then(|| {
            path.extension()
                .and_then(|value| value.to_str())
                .map(|value| value.to_ascii_lowercase())
        })
        .flatten();
    Ok(ProjectFileEntry {
        name,
        path: normalize_relative(root, &path)?,
        kind,
        extension,
    })
}

fn normalize_relative(root: &Path, target: &Path) -> Result<String, AppError> {
    let relative = target.strip_prefix(root).map_err(|_| outside_error())?;
    Ok(relative
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/"))
}

fn kind_rank(kind: &ProjectFileKind) -> u8 {
    match kind {
        ProjectFileKind::Directory => 0,
        ProjectFileKind::File => 1,
    }
}

fn mime_type(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

fn binary_preview(path: String, size: u64) -> ProjectFilePreview {
    ProjectFilePreview {
        path,
        kind: ProjectFilePreviewKind::Binary,
        mime_type: None,
        content: None,
        bytes: None,
        size,
    }
}

fn outside_error() -> AppError {
    AppError::new("path_outside_project", "路径必须位于当前项目内", false)
}
