// Repro for "评论提交失败，请重试" (comment submission failed).
// Creates the exact same child webview as the production
// `open_browser_panel` command (same label, same init script, same UA),
// pointed at a local HTTP page (default) or a URL given as argv[1].
//
// The page invokes `browser_comment` through the same raw
// `window.__TAURI_INTERNALS__.invoke` the overlay uses, and reports
// the exact rejection string back through:
//   1. a `repro-log://` image beacon (custom scheme), and
//   2. location.hash (survives page CSP), polled from Rust.
use claude_desk_lib::commands::browser::COMMENT_OVERLAY_SCRIPT;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};
use tauri::{LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl};

const PAGE: &str = r#"<!doctype html>
<html><head><meta charset="utf-8"><title>comment repro</title></head>
<body style="font:14px -apple-system">
<h3>browser_comment repro</h3>
<div id="status">running…</div>
</body></html>"#;

const TEST_SCRIPT: &str = r#"
(function () {
  var started = false;
  var send = function (tag, value) {
    var text = String(value);
    try { new Image().src = 'repro-log://' + tag + '?p=' + encodeURIComponent(text); } catch (e) {}
    try { location.hash = 'claudedeskrepro-' + tag + '=' + encodeURIComponent(text); } catch (e) {}
  };
  window.__CLAUDE_DESK_REPRO__ = function () {
    if (started) return;
    started = true;
    if (!window.__TAURI_INTERNALS__ || !window.__TAURI_INTERNALS__.invoke) {
      send('no-internals', 'window.__TAURI_INTERNALS__.invoke unavailable at ' + location.href);
      return;
    }
    window.__TAURI_INTERNALS__.invoke('browser_comment', {
      payload: { url: location.href, selection: 'repro selection', comment: 'repro comment' }
    }).then(function () { send('invoke-ok', 'RESOLVED page=' + location.href); },
            function (e) {
              send('invoke-err', ((typeof e === 'string' ? e : JSON.stringify(e))) + ' || page=' + location.href);
            });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(window.__CLAUDE_DESK_REPRO__, 800); });
  } else {
    setTimeout(window.__CLAUDE_DESK_REPRO__, 800);
  }
})();
"#;

fn spawn_page_server() -> std::io::Result<u16> {
  let listener = TcpListener::bind("127.0.0.1:0")?;
  let port = listener.local_addr()?.port();
  std::thread::spawn(move || {
    for stream in listener.incoming() {
      let mut stream = match stream {
        Ok(s) => s,
        Err(_) => continue,
      };
      let mut buf = [0u8; 4096];
      let _ = stream.read(&mut buf);
      let body = PAGE.as_bytes();
      let _ = stream.write_all(
        format!(
          "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
          body.len()
        )
        .as_bytes(),
      );
      let _ = stream.write_all(body);
    }
  });
  Ok(port)
}

fn main() {
  let target = std::env::args().nth(1);
  let url: tauri::Url = match target {
    Some(raw) => raw.parse().expect("invalid url argument"),
    None => {
      let port = spawn_page_server().expect("failed to start page server");
      format!("http://127.0.0.1:{port}/repro.html").parse().unwrap()
    }
  };
  println!("[repro] target url: {url}");

  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      claude_desk_lib::commands::browser::browser_comment
    ])
    .register_uri_scheme_protocol("repro-log", |ctx, request| {
      let uri = request.uri().to_string();
      let mut headers = Vec::new();
      for (name, value) in request.headers().iter() {
        let value = String::from_utf8_lossy(value.as_bytes());
        headers.push(format!("{}: {}", name, value));
      }
      println!("[repro] repro-log hit uri={uri}");
      println!("[repro]   webview label: {}", ctx.webview_label());
      println!("[repro]   headers:\n      {}", headers.join("\n      "));
      let path = uri.trim_start_matches("repro-log://");
      let (tag, param) = match path.split_once("?p=") {
        Some((tag, p)) => (
          tag.to_string(),
          percent_encoding::percent_decode_str(&p.replace('+', "%20"))
            .decode_utf8_lossy()
            .to_string(),
        ),
        None => (path.to_string(), String::new()),
      };
      if !tag.is_empty() && tag != "probe" {
        println!("[repro] ===== {tag} =====");
        println!("[repro] {param}");
        println!("[repro] exiting in 1s");
        std::thread::spawn(|| {
          std::thread::sleep(Duration::from_secs(1));
          std::process::exit(0);
        });
      }
      http::Response::builder()
        .status(200)
        .body(Vec::<u8>::new())
        .unwrap()
    })
    .setup(move |app| {
      let main = app
        .get_window("main")
        .ok_or_else(|| std::io::Error::other("missing main window"))?;

      println!("[repro] creating browser-panel webview for {url}");
      let mut builder = WebviewBuilder::new("browser-panel", WebviewUrl::External(url))
        .initialization_script(COMMENT_OVERLAY_SCRIPT)
        .initialization_script(TEST_SCRIPT);
      // Mirror the INSTALLED app (built from 90937b3, no UA override) when
      // REPRO_NO_UA=1 is set; otherwise mirror current production (UA fix).
      if std::env::var("REPRO_NO_UA").ok().as_deref() != Some("1") {
        #[cfg(target_os = "macos")]
        {
          builder = builder.user_agent(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
          );
        }
      }
      let webview = main.add_child(
        builder,
        LogicalPosition::new(100.0, 100.0),
        LogicalSize::new(900.0, 500.0),
      )?;
      webview.show()?;

      // Poll location.hash reports (survives page CSP).
      let polling_webview = webview.clone();
      std::thread::spawn(move || {
        let t0 = Instant::now();
        let mut last = String::new();
        loop {
          std::thread::sleep(Duration::from_millis(300));
          if let Ok(current) = polling_webview.url() {
            let s = current.as_str();
            if s != last {
              println!("[repro] +{:>5}ms webview url: {s}", t0.elapsed().as_millis());
              last = s.to_string();
            }
            if s.contains("claudedeskrepro-") {
              let decoded = s.replace("%22", "\"").replace("%20", " ");
              println!("[repro] ===== hash report =====");
              println!("[repro] {decoded}");
              println!("[repro] exiting in 1s");
              std::thread::sleep(Duration::from_secs(1));
              std::process::exit(0);
            }
          }
          if t0.elapsed() > Duration::from_secs(45) {
            println!("[repro] TIMEOUT: no report received within 45s");
            std::process::exit(2);
          }
        }
      });
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[cfg(test)]
mod pattern_tests {
  use tauri::utils::acl::RemoteUrlPattern;

  fn matches(pattern: &str, url: &str) -> bool {
    let pattern: RemoteUrlPattern = pattern.parse().expect("pattern parses");
    pattern.test(&url.parse().expect("url parses"))
  }

  #[test]
  fn verify_remote_url_pattern_semantics() {
    // The capability in src-tauri/capabilities/browser.json uses these two patterns.
    let cases: Vec<(&str, &str, bool)> = vec![
      // default-port https (production doubao case)
      ("https://*", "https://www.doubao.com/chat/abc", true),
      ("https://*", "https://www.doubao.com", true),
      // explicit port — the repro server case
      ("http://*", "http://127.0.0.1:58660/", false),
      ("http://*", "http://127.0.0.1:58660/repro.html", false),
      // no port
      ("http://*", "http://localhost:1420", false),
      ("http://*", "http://example.com/path?q=1", true),
      // explicit 443 on https (normalized away by the url crate)
      ("https://*", "https://www.doubao.com:443/chat", true),
      // Origin-header style URL (what parse_invoke_request receives)
      ("https://*", "https://www.doubao.com/", true),
      // PROPOSED FIX: port wildcard must match both explicit-port and
      // default-port URLs (the user browses http://localhost:3000).
      ("http://*:*", "http://localhost:3000", true),
      ("http://*:*", "http://localhost:3000/events", true),
      ("http://*:*", "http://example.com/path", true),
      ("http://*:*", "http://127.0.0.1:58660/", true),
      ("https://*:*", "https://www.doubao.com/chat/abc", true),
    ];
    for (pattern, url, expected) in cases {
      let actual = matches(pattern, url);
      println!("pattern={pattern:?} url={url:?} -> {actual} (expected {expected})");
      assert_eq!(actual, expected, "pattern={pattern:?} url={url:?}");
    }
  }
}
