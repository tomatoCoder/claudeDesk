use claude_desk_lib::sessions::SessionDeletePlan;

#[test]
fn resolves_only_exact_session_targets_under_claude_root() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join(".claude");
    let project = root.join("projects/-Users-test-project");
    let session_id = "550e8400-e29b-41d4-a716-446655440000";
    std::fs::create_dir_all(project.join(session_id).join("subagents")).unwrap();
    std::fs::write(project.join(format!("{session_id}.jsonl")), "{}").unwrap();
    std::fs::write(project.join("550e8400-e29b-41d4-a716-446655440000-copy.jsonl"), "{}").unwrap();
    std::fs::write(project.join("other.jsonl"), "{}").unwrap();

    let plan = SessionDeletePlan::resolve(&root, session_id).unwrap();
    let names = plan.targets().iter().map(|path| path.file_name().unwrap().to_string_lossy().into_owned()).collect::<Vec<_>>();

    assert_eq!(names, vec![session_id.to_string(), format!("{session_id}.jsonl")]);
    let canonical_root = root.canonicalize().unwrap();
    assert!(plan.targets().iter().all(|path| path.starts_with(&canonical_root)));
}

#[test]
fn rejects_partial_or_non_uuid_session_identifiers() {
    let temp = tempfile::tempdir().unwrap();
    let error = SessionDeletePlan::resolve(temp.path(), "550e8400").unwrap_err();
    assert_eq!(error.code, "invalid_session_id");
}
