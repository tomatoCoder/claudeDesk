use claude_desk_lib::{
    domain::ProjectFilePreviewKind,
    files::{list_directory, read_preview},
};

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
