use tauri::command;

/// Reads file paths from the macOS drag pasteboard.
///
/// WKWebView deliberately hides `file://` URLs from `DataTransfer.getData`
/// when the drag contains files, and dropped `File` objects carry no absolute
/// path. The frontend therefore asks the backend to pull the real paths off
/// the drag pasteboard right after a `drop` event.
///
/// Drag sources expose the paths through different pasteboard flavors, so we
/// try several channels in priority order:
///
/// 1. Modern file URLs (`public.file-url`) — Finder and most native apps.
/// 2. Legacy `NSFilenamesPboardType` property list — Java/Swing apps such as
///    IntelliJ IDEA.
/// 3. Plain-text lines that look like existing absolute paths — Chromium /
///    Electron apps (VSCode, Qoder, …) write the dragged files' absolute
///    paths into `public.utf8-plain-text` while providing no file-URL flavor
///    at all (only generic `public.url` + HFS file promises).
#[cfg(target_os = "macos")]
#[command]
pub fn read_drag_file_paths() -> Vec<String> {
    use objc2::rc::autoreleasepool;
    use objc2::ClassType;
    use objc2_app_kit::{
        NSPasteboard, NSPasteboardNameDrag, NSPasteboardURLReadingFileURLsOnlyKey,
    };
    use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSURL};

    autoreleasepool(|_| {
        let board = unsafe { NSPasteboard::pasteboardWithName(NSPasteboardNameDrag) };

        // 1) File URLs (Finder and most native apps).
        let classes = NSArray::from_slice(&[NSURL::class()]);
        let options = NSDictionary::from_slices(
            &[unsafe { NSPasteboardURLReadingFileURLsOnlyKey }],
            &[NSNumber::new_bool(true).as_ref()],
        );
        if let Some(objects) =
            unsafe { board.readObjectsForClasses_options(&classes, Some(&options)) }
        {
            let paths: Vec<String> = objects
                .iter()
                .filter_map(|obj| obj.downcast::<NSURL>().ok())
                .filter(|url| url.isFileURL())
                .filter_map(|url| url.path().map(|path| path.to_string()))
                .collect();
            if !paths.is_empty() {
                return paths;
            }
        }

        // 2) Legacy NSFilenamesPboardType plist (Java/Swing: IDEA).
        if let Some(paths) = read_legacy_filenames(&board) {
            return paths;
        }

        // 3) Chromium/Electron sources write absolute paths as plain text.
        if let Some(paths) = read_text_paths(&board) {
            return paths;
        }

        Vec::new()
    })
}

#[cfg(target_os = "macos")]
fn read_legacy_filenames(board: &objc2_app_kit::NSPasteboard) -> Option<Vec<String>> {
    #[allow(deprecated)]
    use objc2_app_kit::NSFilenamesPboardType;
    use objc2_foundation::{NSArray, NSString};

    #[allow(deprecated)]
    let filenames_type = unsafe { NSFilenamesPboardType };
    let list = board.propertyListForType(filenames_type)?;
    let list = list.downcast::<NSArray>().ok()?;
    let mut paths = Vec::new();
    for item in list {
        let item = item.downcast::<NSString>().ok()?;
        paths.push(item.to_string());
    }
    if paths.is_empty() { None } else { Some(paths) }
}

#[cfg(target_os = "macos")]
fn read_text_paths(board: &objc2_app_kit::NSPasteboard) -> Option<Vec<String>> {
    use objc2_app_kit::NSPasteboardTypeString;
    use std::path::Path;

    let text = board.stringForType(unsafe { NSPasteboardTypeString })?;
    let paths: Vec<String> = text
        .to_string()
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with('/'))
        // 只接受真实存在的路径：编辑器里拖出的普通文本选区不应被误当成附件。
        .filter(|line| Path::new(line).exists())
        .map(str::to_string)
        .collect();
    if paths.is_empty() { None } else { Some(paths) }
}

#[cfg(not(target_os = "macos"))]
#[command]
pub fn read_drag_file_paths() -> Vec<String> {
    Vec::new()
}
