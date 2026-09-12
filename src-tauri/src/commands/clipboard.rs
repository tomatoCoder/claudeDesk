use crate::error::AppError;
use std::path::{Path, PathBuf};
use tauri::{command, Manager};

#[command(rename_all = "camelCase")]
pub fn save_clipboard_file(
    app: tauri::AppHandle,
    name: String,
    mime_type: String,
    bytes: Vec<u8>,
) -> Result<String, AppError> {
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| AppError::new("clipboard_cache_unavailable", error.to_string(), true))?
        .join("clipboard");
    let path = save_clipboard_file_to_dir(&directory, &name, &mime_type, &bytes)?;
    Ok(path.to_string_lossy().into_owned())
}

pub fn save_clipboard_file_to_dir(
    directory: &Path,
    name: &str,
    mime_type: &str,
    bytes: &[u8],
) -> Result<PathBuf, AppError> {
    if bytes.is_empty() {
        return Err(AppError::new(
            "empty_clipboard_file",
            "剪贴板文件内容为空",
            true,
        ));
    }

    std::fs::create_dir_all(directory)?;
    let original = Path::new(name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("pasted-file");
    let original_path = Path::new(original);
    let stem = sanitize_segment(
        original_path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("pasted-file"),
    );
    let extension = safe_extension(original_path).or_else(|| mime_extension(mime_type));
    let unique = uuid::Uuid::new_v4();
    let filename = match extension {
        Some(extension) => format!("{stem}-{unique}.{extension}"),
        None => format!("{stem}-{unique}"),
    };
    let path = directory.join(filename);
    std::fs::write(&path, bytes)?;
    Ok(path)
}

fn sanitize_segment(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .take(80)
        .collect();
    let sanitized = sanitized.trim_matches('_');
    if sanitized.is_empty() {
        "pasted-file".to_string()
    } else {
        sanitized.to_string()
    }
}

fn safe_extension(path: &Path) -> Option<String> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    (!extension.is_empty()
        && extension.len() <= 12
        && extension
            .chars()
            .all(|character| character.is_ascii_alphanumeric()))
    .then_some(extension)
}

fn mime_extension(mime_type: &str) -> Option<String> {
    let extension = match mime_type.to_ascii_lowercase().as_str() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/tiff" => "tiff",
        "image/bmp" => "bmp",
        "image/svg+xml" => "svg",
        "application/pdf" => "pdf",
        "text/plain" => "txt",
        _ => return None,
    };
    Some(extension.to_string())
}
