use crate::error::AppError;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl};

const BROWSER_LABEL: &str = "browser-panel";
const MAX_URL_LENGTH: usize = 4096;
const MAX_SELECTION_LENGTH: usize = 20_000;
const MAX_COMMENT_LENGTH: usize = 4_000;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCommentPayload {
    pub url: String,
    pub selection: String,
    pub comment: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPanelBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub viewport_width: f64,
    pub viewport_height: f64,
    pub visible: bool,
}

fn browser_error(code: &str, message: &str) -> AppError {
    AppError::new(code, message, true)
}

fn main_window(app: &AppHandle) -> Result<tauri::Window, AppError> {
    app.get_window("main")
        .or_else(|| app.windows().into_values().next())
        .ok_or_else(|| browser_error("main_window_missing", "主窗口不可用"))
}

fn panel_geometry(main: &tauri::Window, bounds: &BrowserPanelBounds) -> (LogicalPosition<f64>, LogicalSize<f64>) {
    let scale_factor = main.scale_factor().unwrap_or(1.0);
    let native_size = main
        .inner_size()
        .map(|size| size.to_logical::<f64>(scale_factor))
        .unwrap_or_else(|_| LogicalSize::new(bounds.viewport_width, bounds.viewport_height));
    geometry_for_viewport(native_size, bounds)
}

fn geometry_for_viewport(native_size: LogicalSize<f64>, bounds: &BrowserPanelBounds) -> (LogicalPosition<f64>, LogicalSize<f64>) {
    let scale_x = if bounds.viewport_width.is_finite() && bounds.viewport_width > 0.0 {
        native_size.width / bounds.viewport_width
    } else {
        1.0
    };
    // WKWebView's CSS viewport excludes the native top safe area on macOS.
    // Scaling Y independently stretches the page into that inset and covers the toolbar.
    // CSS zoom is uniform: derive it from width, then reserve the missing top area.
    let top_inset = (native_size.height - bounds.viewport_height * scale_x).max(0.0);
    (
        LogicalPosition::new(bounds.x * scale_x, top_inset + bounds.y * scale_x),
        LogicalSize::new((bounds.width * scale_x).max(1.0), (bounds.height * scale_x).max(1.0)),
    )
}

fn parse_browser_url(value: &str) -> Result<tauri::Url, AppError> {
    let raw = value.trim();
    if raw.is_empty() {
        return Err(browser_error("browser_url_required", "请输入网址"));
    }
    if raw.len() > MAX_URL_LENGTH {
        return Err(browser_error("browser_url_too_long", "网址过长"));
    }
    let candidate = if raw.contains("://") { raw.to_owned() } else { format!("https://{raw}") };
    let url = candidate
        .parse::<tauri::Url>()
        .map_err(|_| browser_error("browser_url_invalid", "网址格式无效"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(browser_error("browser_url_scheme", "仅支持 http 或 https 网址"));
    }
    Ok(url)
}

fn validate_comment(payload: &BrowserCommentPayload) -> Result<(), AppError> {
    parse_browser_url(&payload.url)?;
    if payload.selection.trim().is_empty() {
        return Err(browser_error("browser_selection_required", "请先选择网页文本"));
    }
    if payload.selection.len() > MAX_SELECTION_LENGTH {
        return Err(browser_error("browser_selection_too_long", "选中文本过长"));
    }
    if payload.comment.trim().is_empty() {
        return Err(browser_error("browser_comment_required", "请输入评论"));
    }
    if payload.comment.len() > MAX_COMMENT_LENGTH {
        return Err(browser_error("browser_comment_too_long", "评论过长"));
    }
    Ok(())
}

const COMMENT_OVERLAY_SCRIPT: &str = r#"
(() => {
  if (window.__CLAUDE_DESK_BROWSER_COMMENT__) return;
  window.__CLAUDE_DESK_BROWSER_COMMENT__ = true;
  let annotationMode = false;
  let overlay;
  let hover;
  let selectedText = '';
  const close = () => { overlay?.remove(); overlay = undefined; };
  const isInsideOverlay = (event) => !!overlay && event.composedPath().includes(overlay);
  const invoke = (payload) => {
    const api = window.__TAURI_INTERNALS__;
    if (!api?.invoke) return Promise.reject(new Error('Claude Desk IPC is unavailable'));
    return api.invoke('browser_comment', { payload });
  };
  const clearHover = () => { if (hover) { hover.style.outline = hover.dataset.claudeDeskOutline || ''; delete hover.dataset.claudeDeskOutline; hover = undefined; } };
  const pick = (element) => {
    if (!(element instanceof HTMLElement) || element === overlay || element === document.body || element === document.documentElement) return;
    clearHover(); hover = element; hover.dataset.claudeDeskOutline = hover.style.outline; hover.style.outline = '2px solid rgba(70, 130, 255, .7)';
  };
  const describe = (element) => {
    if (!(element instanceof HTMLElement)) return '';
    const text = (element.innerText || element.textContent || '').trim();
    if (text) return text;
    const value = 'value' in element ? String(element.value || '').trim() : '';
    if (value) return value;
    const label = element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.getAttribute('title');
    if (label) return label.trim();
    const id = element.id ? `#${element.id}` : '';
    const classes = [...element.classList].slice(0, 2).map((name) => `.${name}`).join('');
    return `<${element.tagName.toLowerCase()}${id}${classes}>`;
  };
  const open = (element) => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() || describe(element);
    if (!text || text.length > 20000) return close();
    selectedText = text;
    close();
    const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : element.getBoundingClientRect();
    overlay = document.createElement('div');
    overlay.style.cssText = `position:fixed;z-index:2147483647;left:${Math.max(12, Math.min(window.innerWidth - 330, rect.left))}px;top:${Math.max(12, Math.min(window.innerHeight - 58, rect.bottom + 8))}px`;
    const shadow = overlay.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>:host{all:initial}.box{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:7px;width:320px;padding:8px 9px;border:1px solid #d8d8d8;border-radius:15px;background:#fff;box-shadow:0 8px 26px rgba(0,0,0,.18);font:12px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}.input{width:100%;min-width:0;border:0;outline:0;color:#252525;font:inherit}.cancel,.submit{border:0;border-radius:7px;padding:5px 7px;cursor:pointer;font:inherit}.cancel{background:transparent;color:#777}.submit{background:#ff6b12;color:#fff}.submit:disabled{opacity:.45;cursor:default}.error{display:none;grid-column:1/-1;padding:0 7px 3px;color:#c43b32;font-size:11px}</style><div class="box"><button class="cancel" type="button">取消</button><input class="input" placeholder="添加评论…" autofocus /><button class="submit" type="button" disabled>评论</button><div class="error"></div></div>`;
    document.documentElement.appendChild(overlay);
    const input = shadow.querySelector('.input');
    const submit = shadow.querySelector('.submit');
    const error = shadow.querySelector('.error');
    shadow.querySelector('.cancel').addEventListener('click', close);
    input.addEventListener('input', () => { submit.disabled = !input.value.trim(); });
    const send = async () => {
      if (!input.value.trim()) return;
      submit.disabled = true;
      error.style.display = 'none';
      try {
        await invoke({ url: location.href, selection: selectedText, comment: input.value.trim() });
        close();
      } catch (cause) {
        submit.disabled = false;
        error.textContent = cause?.message || '评论提交失败，请重试';
        error.style.display = 'block';
      }
    };
    submit.addEventListener('click', send);
    input.addEventListener('keydown', (event) => { event.stopPropagation(); if (event.key === 'Escape') close(); if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) send(); });
    input.focus();
  };
  window.__CLAUDE_DESK_SET_ANNOTATION_MODE__ = (enabled) => { annotationMode = !!enabled; close(); clearHover(); document.documentElement.style.cursor = annotationMode ? 'crosshair' : ''; };
  document.addEventListener('mousemove', (event) => { if (annotationMode && !isInsideOverlay(event)) pick(event.target); }, true);
  document.addEventListener('click', (event) => { if (annotationMode && !isInsideOverlay(event)) { event.preventDefault(); event.stopPropagation(); open(event.target); } }, true);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); }, true);
  document.addEventListener('mousedown', (event) => { if (overlay && !isInsideOverlay(event)) close(); }, true);
})();
"#;

#[tauri::command(rename_all = "camelCase")]
pub async fn open_browser_panel(url: String, bounds: BrowserPanelBounds, app: AppHandle) -> Result<(), AppError> {
    let url = parse_browser_url(&url)?;
    let main = main_window(&app)?;
    let (position, size) = panel_geometry(&main, &bounds);
    if let Some(webview) = app.get_webview(BROWSER_LABEL) {
        webview.navigate(url).map_err(|error| browser_error("browser_navigation_failed", &error.to_string()))?;
        webview.set_bounds(tauri::Rect { position: position.into(), size: size.into() }).map_err(|error| browser_error("browser_bounds_failed", &error.to_string()))?;
        if bounds.visible { webview.show().map_err(|error| browser_error("browser_show_failed", &error.to_string()))?; } else { webview.hide().map_err(|error| browser_error("browser_hide_failed", &error.to_string()))?; }
        return Ok(());
    }
    let webview = main.add_child(
        WebviewBuilder::new(BROWSER_LABEL, WebviewUrl::External(url))
            .initialization_script(COMMENT_OVERLAY_SCRIPT)
            .on_page_load(|webview, payload| {
                let _ = webview.app_handle().emit_to("main", "browser-page-state", serde_json::json!({
                    "url": payload.url().as_str(),
                    "loading": matches!(payload.event(), tauri::webview::PageLoadEvent::Started),
                }));
            }),
        position,
        size,
    )
    .map_err(|error| browser_error("browser_create_failed", &error.to_string()))?;
    if bounds.visible { webview.show().map_err(|error| browser_error("browser_show_failed", &error.to_string()))?; } else { webview.hide().map_err(|error| browser_error("browser_hide_failed", &error.to_string()))?; }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_browser_panel_bounds(bounds: BrowserPanelBounds, app: AppHandle) -> Result<(), AppError> {
    let main = main_window(&app)?;
    let (position, size) = panel_geometry(&main, &bounds);
    let Some(webview) = app.get_webview(BROWSER_LABEL) else { return Ok(()) };
    webview.set_bounds(tauri::Rect { position: position.into(), size: size.into() }).map_err(|error| browser_error("browser_bounds_failed", &error.to_string()))?;
    if bounds.visible { webview.show().map_err(|error| browser_error("browser_show_failed", &error.to_string()))?; } else { webview.hide().map_err(|error| browser_error("browser_hide_failed", &error.to_string()))?; }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn refresh_browser_panel(app: AppHandle) -> Result<(), AppError> {
    if let Some(webview) = app.get_webview(BROWSER_LABEL) {
        webview.reload().map_err(|error| browser_error("browser_refresh_failed", &error.to_string()))?;
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_browser_annotation_mode(enabled: bool, app: AppHandle) -> Result<(), AppError> {
    if let Some(webview) = app.get_webview(BROWSER_LABEL) {
        let value = if enabled { "true" } else { "false" };
        webview.eval(format!("window.__CLAUDE_DESK_SET_ANNOTATION_MODE__?.({value})")).map_err(|error| browser_error("browser_annotation_failed", &error.to_string()))?;
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn close_browser_panel(app: AppHandle) -> Result<(), AppError> {
    if let Some(webview) = app.get_webview(BROWSER_LABEL) {
        webview.hide().map_err(|error| browser_error("browser_hide_failed", &error.to_string()))?;
        let _ = webview.eval("window.__CLAUDE_DESK_SET_ANNOTATION_MODE__?.(false)");
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_browser(url: String, app: AppHandle) -> Result<(), AppError> {
    // Backward-compatible alias for callers from earlier builds.
    open_browser_panel(url, BrowserPanelBounds {
        x: 0.0,
        y: 0.0,
        width: 1.0,
        height: 1.0,
        viewport_width: 1.0,
        viewport_height: 1.0,
        visible: false,
    }, app).await
}

#[tauri::command(rename_all = "camelCase")]
pub fn browser_comment(payload: BrowserCommentPayload, app: AppHandle) -> Result<(), AppError> {
    validate_comment(&payload)?;
    let main = main_window(&app)?;
    main.emit("browser-comment", payload)
        .map_err(|error| browser_error("browser_comment_emit_failed", &error.to_string()))
}

#[tauri::command(rename_all = "camelCase")]
pub fn browser_history(direction: String, app: AppHandle) -> Result<(), AppError> {
    let script = match direction.as_str() {
        "back" => "history.back()",
        "forward" => "history.forward()",
        _ => return Err(browser_error("browser_history_invalid", "无效的浏览方向")),
    };
    if let Some(webview) = app.get_webview(BROWSER_LABEL) {
        webview.eval(script).map_err(|error| browser_error("browser_history_failed", &error.to_string()))?;
    }
    Ok(())
}

#[cfg(test)]
mod geometry_tests {
    use super::*;

    #[test]
    fn reserves_native_top_inset_instead_of_stretching_css_coordinates() {
        let bounds = BrowserPanelBounds { x: 600.0, y: 88.0, width: 680.0, height: 704.0, viewport_width: 1280.0, viewport_height: 792.0, visible: true };
        let (position, size) = geometry_for_viewport(LogicalSize::new(1280.0, 820.0), &bounds);
        assert_eq!(position.y, 116.0);
        assert_eq!(size.height, 704.0);
        assert_eq!(position.y + size.height, 820.0);
    }

    #[test]
    fn scales_zoomed_css_uniformly_and_preserves_toolbar_gap() {
        let bounds = BrowserPanelBounds { x: 300.0, y: 88.0, width: 340.0, height: 308.0, viewport_width: 640.0, viewport_height: 396.0, visible: true };
        let (position, size) = geometry_for_viewport(LogicalSize::new(1280.0, 820.0), &bounds);
        assert_eq!(position.x, 600.0);
        assert_eq!(position.y, 204.0);
        assert_eq!(size.height, 616.0);
    }
}
