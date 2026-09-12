use claude_desk_lib::domain::{AppPermissionMode, AppSettingsDto};
use claude_desk_lib::storage::Storage;

#[test]
fn legacy_settings_json_without_permission_mode_deserializes_to_default() {
    let legacy = r#"{"claudePath":null,"sidebarWidth":280,"theme":"system","language":"zh-CN","openWith":"default"}"#;
    let settings: AppSettingsDto = serde_json::from_str(legacy).unwrap();
    assert_eq!(settings.permission_mode, AppPermissionMode::Default);
}

#[test]
fn permission_mode_roundtrips_through_storage() {
    let temp = tempfile::tempdir().unwrap();
    let storage = Storage::open(temp.path().join("app.db")).unwrap();
    let mut settings = storage.load_settings().unwrap();
    settings.permission_mode = AppPermissionMode::Bypass;
    storage.save_settings(&settings).unwrap();
    assert_eq!(storage.load_settings().unwrap().permission_mode, AppPermissionMode::Bypass);
}

#[test]
fn app_settings_serialize_permission_mode_camel_case() {
    let settings = AppSettingsDto { permission_mode: AppPermissionMode::Auto, ..AppSettingsDto::default() };
    let json = serde_json::to_value(&settings).unwrap();
    assert_eq!(json["permissionMode"], "auto");
}
