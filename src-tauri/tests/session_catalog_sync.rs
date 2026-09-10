use claude_desk_lib::storage::Storage;

#[test]
fn discovered_session_is_upserted_by_claude_session_id() {
    let temp = tempfile::tempdir().unwrap();
    let project_path = temp.path().join("project");
    std::fs::create_dir(&project_path).unwrap();
    let storage = Storage::open(temp.path().join("app.db")).unwrap();
    let project = storage.create_or_touch_project("project", &project_path).unwrap();

    let first = storage.upsert_claude_session(&project.id, "550e8400-e29b-41d4-a716-446655440000", "初始标题", "2026-09-09T00:00:00Z").unwrap();
    let second = storage.upsert_claude_session(&project.id, "550e8400-e29b-41d4-a716-446655440000", "更新标题", "2026-09-09T01:00:00Z").unwrap();

    assert_eq!(first.id, second.id);
    assert_eq!(second.title, "更新标题");
    assert_eq!(storage.list_project_tasks(&project.id).unwrap().len(), 1);
}
