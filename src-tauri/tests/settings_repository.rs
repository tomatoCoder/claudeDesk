use claude_desk_lib::settings::{ManagedSettings, SettingsPatch, SettingsRepository};

#[test]
fn missing_file_is_an_empty_managed_settings_view() {
    let temp = tempfile::tempdir().unwrap();
    let repository = SettingsRepository::new(temp.path().join(".claude/settings.json"));

    let loaded = repository.load().unwrap();

    assert_eq!(loaded.values, ManagedSettings::default());
    assert!(!loaded.version.is_empty());
}

#[test]
fn save_preserves_unmanaged_json_and_removes_empty_managed_fields() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join(".claude/settings.json");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(
        &path,
        r#"{"permissions":{"allow":["Read"]},"env":{"KEEP":"yes","ANTHROPIC_MODEL":"old","ANTHROPIC_AUTH_TOKEN":"secret"}}"#,
    )
    .unwrap();
    let repository = SettingsRepository::new(path.clone());
    let loaded = repository.load().unwrap();

    repository
        .save(
            &loaded.version,
            SettingsPatch {
                auth_token: Some(String::new()),
                base_url: Some("https://gateway.example.com".into()),
                model: Some("gateway-sonnet".into()),
            },
        )
        .unwrap();

    let saved: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(saved.pointer("/permissions/allow/0"), Some(&serde_json::json!("Read")));
    assert_eq!(saved.pointer("/env/KEEP"), Some(&serde_json::json!("yes")));
    assert_eq!(saved.pointer("/env/ANTHROPIC_AUTH_TOKEN"), None);
    assert_eq!(saved.pointer("/env/ANTHROPIC_BASE_URL"), Some(&serde_json::json!("https://gateway.example.com")));
    assert_eq!(saved.pointer("/env/ANTHROPIC_MODEL"), Some(&serde_json::json!("gateway-sonnet")));
    assert!(repository.backup_paths().unwrap().len() == 1);
}

#[test]
fn external_change_blocks_stale_save_without_overwriting() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("settings.json");
    std::fs::write(&path, r#"{"env":{"ANTHROPIC_MODEL":"first"}}"#).unwrap();
    let repository = SettingsRepository::new(path.clone());
    let loaded = repository.load().unwrap();
    std::fs::write(&path, r#"{"env":{"ANTHROPIC_MODEL":"external"}}"#).unwrap();

    let error = repository
        .save(
            &loaded.version,
            SettingsPatch {
                model: Some("local".into()),
                ..SettingsPatch::default()
            },
        )
        .unwrap_err();

    assert_eq!(error.code, "settings_conflict");
    assert!(std::fs::read_to_string(path).unwrap().contains("external"));
}

#[test]
fn invalid_json_is_never_overwritten() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("settings.json");
    std::fs::write(&path, "{broken").unwrap();
    let repository = SettingsRepository::new(path.clone());

    let error = repository.load().unwrap_err();

    assert_eq!(error.code, "settings_invalid_json");
    assert_eq!(std::fs::read_to_string(path).unwrap(), "{broken");
}
