pub mod application;
pub mod diagnostics;
pub mod drag;
pub mod permissions;
pub mod projects;
pub mod settings;
pub mod sessions;
pub mod tasks;

use crate::{diagnostics::LogStore, permission::PermissionHub, settings::SettingsRepository, storage::Storage, task::TaskCoordinator};

pub struct AppState {
    pub storage: Storage,
    pub coordinator: TaskCoordinator,
    pub permissions: PermissionHub,
    pub logs: LogStore,
    pub settings: SettingsRepository,
}

pub fn validate_id(value: &str) -> Result<(), crate::error::AppError> {
    uuid::Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| crate::error::AppError::new("invalid_identifier", "无效的对象标识", false))
}
