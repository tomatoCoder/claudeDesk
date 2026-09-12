use claude_desk_lib::commands::clipboard::save_clipboard_file_to_dir;

#[test]
fn saves_clipboard_image_with_safe_unique_name() {
    let temp = tempfile::tempdir().unwrap();

    let first = save_clipboard_file_to_dir(
        temp.path(),
        "../../Screenshot.png",
        "image/png",
        &[137, 80, 78, 71],
    )
    .unwrap();
    let second =
        save_clipboard_file_to_dir(temp.path(), "../../Screenshot.png", "image/png", &[1, 2, 3])
            .unwrap();

    assert_eq!(first.parent(), Some(temp.path()));
    assert_eq!(std::fs::read(&first).unwrap(), [137, 80, 78, 71]);
    assert_eq!(std::fs::read(&second).unwrap(), [1, 2, 3]);
    assert_ne!(first, second);
    assert_eq!(
        first.extension().and_then(|value| value.to_str()),
        Some("png")
    );
}

#[test]
fn derives_an_extension_when_clipboard_image_has_no_name() {
    let temp = tempfile::tempdir().unwrap();

    let path = save_clipboard_file_to_dir(temp.path(), "", "image/jpeg", &[255, 216]).unwrap();

    assert_eq!(
        path.extension().and_then(|value| value.to_str()),
        Some("jpg")
    );
    assert_eq!(std::fs::read(path).unwrap(), [255, 216]);
}
