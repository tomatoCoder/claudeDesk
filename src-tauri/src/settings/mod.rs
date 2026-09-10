use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::error::AppError;

const AUTH_TOKEN: &str = "ANTHROPIC_AUTH_TOKEN";
const BASE_URL: &str = "ANTHROPIC_BASE_URL";
const MODEL: &str = "ANTHROPIC_MODEL";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagedSettings {
    pub auth_token: String,
    pub base_url: String,
    pub model: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub auth_token: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub values: ManagedSettings,
    pub version: String,
    pub path: String,
}

#[derive(Debug, Clone)]
pub struct SettingsRepository {
    path: PathBuf,
}

impl SettingsRepository {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn user_default() -> Result<Self, AppError> {
        let home = dirs::home_dir().ok_or_else(|| {
            AppError::new("home_not_found", "无法确定当前用户目录", false)
        })?;
        Ok(Self::new(home.join(".claude").join("settings.json")))
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self) -> Result<SettingsView, AppError> {
        let bytes = match fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(error.into()),
        };
        let root = parse_root(&bytes)?;
        let env = root.get("env").and_then(Value::as_object);
        Ok(SettingsView {
            values: ManagedSettings {
                auth_token: env.and_then(|value| string(value, AUTH_TOKEN)).unwrap_or_default(),
                base_url: env.and_then(|value| string(value, BASE_URL)).unwrap_or_default(),
                model: env.and_then(|value| string(value, MODEL)).unwrap_or_default(),
            },
            version: content_version(&bytes),
            path: self.path.to_string_lossy().into_owned(),
        })
    }

    pub fn save(&self, expected_version: &str, patch: SettingsPatch) -> Result<SettingsView, AppError> {
        let current = match fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(error.into()),
        };
        if content_version(&current) != expected_version {
            return Err(AppError::new(
                "settings_conflict",
                "settings.json 已被其他程序修改，请刷新后再保存",
                true,
            ));
        }
        let mut root = parse_root(&current)?;
        let root_object = root.as_object_mut().expect("parse_root 始终返回对象");
        let env = root_object
            .entry("env")
            .or_insert_with(|| Value::Object(Map::new()));
        if !env.is_object() {
            return Err(AppError::new(
                "settings_invalid_env",
                "settings.json 中的 env 必须是对象",
                true,
            ));
        }
        let env = env.as_object_mut().expect("env 已验证为对象");
        merge_field(env, AUTH_TOKEN, patch.auth_token);
        merge_field(env, BASE_URL, patch.base_url);
        merge_field(env, MODEL, patch.model);

        let parent = self.path.parent().ok_or_else(|| {
            AppError::new("settings_path_invalid", "设置文件路径无效", false)
        })?;
        fs::create_dir_all(parent)?;
        if !current.is_empty() {
            fs::copy(&self.path, self.backup_path())?;
        }
        let bytes = serde_json::to_vec_pretty(&root)?;
        let temp_path = parent.join(format!(
            ".settings.json.{}.tmp",
            uuid::Uuid::new_v4()
        ));
        fs::write(&temp_path, &bytes)?;
        set_owner_only(&temp_path)?;
        #[cfg(windows)]
        if self.path.exists() {
            fs::remove_file(&self.path)?;
        }
        fs::rename(&temp_path, &self.path)?;
        set_owner_only(&self.path)?;
        self.load()
    }

    pub fn backup_paths(&self) -> Result<Vec<PathBuf>, AppError> {
        let Some(parent) = self.path.parent() else { return Ok(Vec::new()) };
        if !parent.exists() { return Ok(Vec::new()) }
        let prefix = format!(
            "{}.backup-",
            self.path.file_name().and_then(|name| name.to_str()).unwrap_or("settings.json")
        );
        let mut paths = fs::read_dir(parent)?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.starts_with(&prefix)))
            .collect::<Vec<_>>();
        paths.sort();
        Ok(paths)
    }

    fn backup_path(&self) -> PathBuf {
        let parent = self.path.parent().unwrap_or_else(|| Path::new("."));
        let file = self.path.file_name().and_then(|name| name.to_str()).unwrap_or("settings.json");
        parent.join(format!(
            "{file}.backup-{}-{}",
            chrono::Utc::now().format("%Y%m%dT%H%M%S%.3fZ"),
            uuid::Uuid::new_v4()
        ))
    }
}

fn parse_root(bytes: &[u8]) -> Result<Value, AppError> {
    if bytes.is_empty() {
        return Ok(Value::Object(Map::new()));
    }
    let value: Value = serde_json::from_slice(bytes).map_err(|error| {
        AppError::new(
            "settings_invalid_json",
            format!("settings.json 不是有效 JSON：{error}"),
            true,
        )
    })?;
    if value.is_object() {
        Ok(value)
    } else {
        Err(AppError::new(
            "settings_invalid_root",
            "settings.json 顶层必须是对象",
            true,
        ))
    }
}

fn string(env: &Map<String, Value>, key: &str) -> Option<String> {
    env.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn merge_field(env: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        if value.trim().is_empty() {
            env.remove(key);
        } else {
            env.insert(key.into(), Value::String(value));
        }
    }
}

fn content_version(bytes: &[u8]) -> String {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

#[cfg(unix)]
fn set_owner_only(path: &Path) -> Result<(), AppError> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(not(unix))]
fn set_owner_only(_path: &Path) -> Result<(), AppError> {
    Ok(())
}
