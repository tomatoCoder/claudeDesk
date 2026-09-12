use tauri::command;

/// Reads file paths from the macOS drag pasteboard.
///
/// WKWebView deliberately hides `file://` URLs from `DataTransfer.getData`
/// when the drag contains files, and dropped `File` objects carry no absolute
/// path. The frontend therefore asks the backend to pull the real paths off
/// the drag pasteboard right after a `drop` event.
#[cfg(target_os = "macos")]
#[command]
pub fn read_drag_file_paths() -> Vec<String> {
    use objc2::rc::autoreleasepool;
    use objc2::ClassType;
    use objc2_app_kit::{NSPasteboard, NSPasteboardNameDrag, NSPasteboardURLReadingFileURLsOnlyKey};
    use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSURL};

    autoreleasepool(|_| {
        let board = unsafe { NSPasteboard::pasteboardWithName(NSPasteboardNameDrag) };
        let classes = NSArray::from_slice(&[NSURL::class()]);
        let options = NSDictionary::from_slices(
            &[unsafe { NSPasteboardURLReadingFileURLsOnlyKey }],
            &[NSNumber::new_bool(true).as_ref()],
        );
        let objects = unsafe { board.readObjectsForClasses_options(&classes, Some(&options)) };
        objects
            .map(|array| {
                array
                    .iter()
                    .filter_map(|obj| obj.downcast::<NSURL>().ok())
                    .filter(|url| url.isFileURL())
                    .filter_map(|url| url.path().map(|path| path.to_string()))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    })
}

#[cfg(not(target_os = "macos"))]
#[command]
pub fn read_drag_file_paths() -> Vec<String> {
    Vec::new()
}
