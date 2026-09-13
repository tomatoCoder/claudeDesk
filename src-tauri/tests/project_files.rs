use claude_desk_lib::{
    commands::files::{list_project_directory, read_project_file, search_project_files},
    domain::{ProjectFileEntry, ProjectFileKind, ProjectFilePreview, ProjectFilePreviewKind},
    files::{list_directory, read_preview, search_files, write_text_file},
};
use std::process::Command;

#[test]
fn lists_directories_first_and_returns_only_relative_paths() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::create_dir(temp.path().join("src")).unwrap();
    std::fs::write(temp.path().join("z.txt"), "z").unwrap();
    std::fs::write(temp.path().join("A.md"), "# A").unwrap();

    let entries = list_directory(temp.path(), "").unwrap();

    assert_eq!(
        entries
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>(),
        vec!["src", "A.md", "z.txt"]
    );
}

#[test]
fn rejects_parent_and_absolute_paths() {
    let temp = tempfile::tempdir().unwrap();

    assert_eq!(
        read_preview(temp.path(), "../secret").unwrap_err().code,
        "path_outside_project"
    );
    assert_eq!(
        read_preview(temp.path(), "/etc/hosts").unwrap_err().code,
        "path_outside_project"
    );
}

#[cfg(unix)]
#[test]
fn rejects_a_symlink_that_leaves_the_project() {
    use std::os::unix::fs::symlink;

    let project = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("secret.txt"), "secret").unwrap();
    symlink(outside.path(), project.path().join("outside")).unwrap();

    let error = read_preview(project.path(), "outside/secret.txt").unwrap_err();

    assert_eq!(error.code, "path_outside_project");
}

#[test]
fn classifies_text_image_binary_and_large_files() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("readme.md"), "# Hello").unwrap();
    std::fs::write(temp.path().join("pixel.png"), [137, 80, 78, 71]).unwrap();
    std::fs::write(temp.path().join("raw.bin"), [0, 1, 2]).unwrap();
    std::fs::write(
        temp.path().join("large.txt"),
        vec![b'x'; 2 * 1024 * 1024 + 1],
    )
    .unwrap();

    assert_eq!(
        read_preview(temp.path(), "readme.md").unwrap().kind,
        ProjectFilePreviewKind::Text
    );
    assert_eq!(
        read_preview(temp.path(), "pixel.png").unwrap().kind,
        ProjectFilePreviewKind::Image
    );
    assert_eq!(
        read_preview(temp.path(), "raw.bin").unwrap().kind,
        ProjectFilePreviewKind::Binary
    );
    assert_eq!(
        read_preview(temp.path(), "large.txt").unwrap().kind,
        ProjectFilePreviewKind::TooLarge
    );
}

#[test]
fn saves_text_edits_including_added_and_deleted_content() {
    let temp = tempfile::tempdir().unwrap();
    let file = temp.path().join("notes.txt");
    std::fs::write(&file, "remove this\nkeep this").unwrap();

    write_text_file(temp.path(), "notes.txt", "added line\nkeep this").unwrap();

    assert_eq!(
        std::fs::read_to_string(file).unwrap(),
        "added line\nkeep this"
    );
}

#[test]
fn rejects_writes_to_non_text_and_outside_paths() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("raw.bin"), [0, 1, 2]).unwrap();
    std::fs::write(temp.path().join("pixel.png"), [137, 80, 78, 71]).unwrap();
    std::fs::create_dir(temp.path().join("folder")).unwrap();

    assert_eq!(
        write_text_file(temp.path(), "raw.bin", "text")
            .unwrap_err()
            .code,
        "file_not_editable"
    );
    assert_eq!(
        write_text_file(temp.path(), "pixel.png", "text")
            .unwrap_err()
            .code,
        "file_not_editable"
    );
    assert_eq!(
        write_text_file(temp.path(), "folder", "text")
            .unwrap_err()
            .code,
        "not_a_file"
    );
    assert_eq!(
        write_text_file(temp.path(), "../outside.txt", "text")
            .unwrap_err()
            .code,
        "path_outside_project"
    );
}

#[test]
fn searches_git_tracked_and_untracked_files_but_not_ignored_files() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(temp.path().join("src")).unwrap();
    std::fs::create_dir_all(temp.path().join("docs")).unwrap();
    std::fs::create_dir_all(temp.path().join("node_modules/pkg")).unwrap();
    std::fs::write(temp.path().join("src/main.ts"), "main").unwrap();
    std::fs::write(temp.path().join("docs/Guide.md"), "guide").unwrap();
    std::fs::write(temp.path().join("node_modules/pkg/dependency.js"), "dep").unwrap();
    std::fs::write(temp.path().join(".gitignore"), "node_modules/\n").unwrap();
    assert!(Command::new("git")
        .args(["init", "-q"])
        .current_dir(temp.path())
        .status()
        .unwrap()
        .success());
    assert!(Command::new("git")
        .args(["add", "src/main.ts"])
        .current_dir(temp.path())
        .status()
        .unwrap()
        .success());

    let found = search_files(temp.path(), "main", 200).unwrap();

    assert_eq!(
        found
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>(),
        vec!["src/main.ts"]
    );
    assert!(search_files(temp.path(), "dependency", 200)
        .unwrap()
        .is_empty());
}

#[test]
fn searches_non_git_projects_with_limits_and_skips_dependency_directories() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(temp.path().join("src")).unwrap();
    std::fs::create_dir_all(temp.path().join("docs")).unwrap();
    std::fs::create_dir_all(temp.path().join("node_modules")).unwrap();
    std::fs::write(temp.path().join("src/main.rs"), "main").unwrap();
    std::fs::write(temp.path().join("docs/main-notes.md"), "notes").unwrap();
    std::fs::write(temp.path().join("node_modules/main.js"), "ignored").unwrap();

    let found = search_files(temp.path(), "main", 200).unwrap();
    let limited = search_files(temp.path(), "main", 1).unwrap();

    assert_eq!(found.len(), 2);
    assert!(found
        .iter()
        .all(|entry| !entry.path.starts_with("node_modules/")));
    assert_eq!(limited.len(), 1);
    assert_eq!(limited[0].path, "src/main.rs");
}

#[test]
fn serialization_contract_uses_camel_case_fields_and_snake_case_kinds() {
    let entry = ProjectFileEntry {
        name: "README.md".to_string(),
        path: "docs/README.md".to_string(),
        kind: ProjectFileKind::File,
        extension: Some("md".to_string()),
    };
    let preview = ProjectFilePreview {
        path: "large.bin".to_string(),
        kind: ProjectFilePreviewKind::TooLarge,
        mime_type: None,
        content: None,
        bytes: None,
        size: 2_097_153,
    };

    assert_eq!(
        serde_json::to_value(entry).unwrap(),
        serde_json::json!({
            "name": "README.md",
            "path": "docs/README.md",
            "kind": "file",
            "extension": "md"
        })
    );
    assert_eq!(
        serde_json::to_value(preview).unwrap(),
        serde_json::json!({
            "path": "large.bin",
            "kind": "too_large",
            "mimeType": null,
            "content": null,
            "bytes": null,
            "size": 2_097_153
        })
    );

    let _commands = (
        list_project_directory,
        search_project_files,
        read_project_file,
    );
}
