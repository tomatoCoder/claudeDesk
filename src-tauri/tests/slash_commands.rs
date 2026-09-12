use claude_desk_lib::{bridge::parse_slash_catalog, domain::TaskPermissionMode, storage::Storage};

#[test]
fn parses_catalog_and_skips_malformed_entries() {
    let value = serde_json::json!({
        "commands": [
            { "name": "review", "description": "Review code", "argumentHint": "<path>", "aliases": ["rv"] },
            { "name": "  ", "description": "empty name" },
            { "description": "missing name" },
        ],
        "models": [
            { "value": "sonnet", "displayName": "Sonnet", "description": "Balanced" },
            { "value": "" },
        ],
    });
    let catalog = parse_slash_catalog(&value).unwrap();
    assert_eq!(catalog.commands.len(), 1);
    assert_eq!(catalog.commands[0].name, "review");
    assert_eq!(catalog.commands[0].aliases, vec!["rv".to_string()]);
    assert_eq!(catalog.models.len(), 1);
    assert_eq!(catalog.models[0].resolved_model, None);
}

#[test]
fn catalog_without_commands_or_models_arrays_is_invalid() {
    assert!(parse_slash_catalog(&serde_json::json!({})).is_err());
}

#[test]
fn task_permission_mode_accepts_only_safe_modes() {
    assert_eq!(
        TaskPermissionMode::parse("default"),
        Some(TaskPermissionMode::Default)
    );
    assert_eq!(
        TaskPermissionMode::parse("acceptEdits"),
        Some(TaskPermissionMode::AcceptEdits)
    );
    assert_eq!(
        TaskPermissionMode::parse("plan"),
        Some(TaskPermissionMode::Plan)
    );
    assert_eq!(
        TaskPermissionMode::parse("dontAsk"),
        Some(TaskPermissionMode::DontAsk)
    );
    assert_eq!(TaskPermissionMode::parse("bypassPermissions"), None);
    assert_eq!(TaskPermissionMode::parse("auto"), None);
    assert_eq!(TaskPermissionMode::parse(""), None);
}

#[test]
fn task_overrides_roundtrip_and_clear_through_storage() {
    let temp = tempfile::tempdir().unwrap();
    let storage = Storage::open(temp.path().join("app.db")).unwrap();
    let project = storage
        .create_or_touch_project("demo", temp.path())
        .unwrap();
    let task = storage.create_task(&project.id, "新任务").unwrap();

    let updated = storage
        .set_task_model_override(&task.id, Some("sonnet"))
        .unwrap();
    assert_eq!(updated.model_override.as_deref(), Some("sonnet"));
    assert_eq!(updated.permission_mode_override, None);

    let updated = storage
        .set_task_permission_mode_override(&task.id, Some(TaskPermissionMode::Plan))
        .unwrap();
    assert_eq!(
        updated.permission_mode_override,
        Some(TaskPermissionMode::Plan)
    );

    let updated = storage.set_task_model_override(&task.id, None).unwrap();
    assert_eq!(updated.model_override, None);
    assert_eq!(
        updated.permission_mode_override,
        Some(TaskPermissionMode::Plan)
    );
}
