// Minimal repro for the browser-panel blank-page bug.
// Creates the exact same child webview the app creates in
// commands::browser::open_browser_panel (same initialization script,
// same on_page_load, same WebviewUrl::External) and logs every page
// load event. If the target site redirect-loops, we will see hundreds
// of Started events without ever settling.
use claude_desk_lib::commands::browser::COMMENT_OVERLAY_SCRIPT;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl};

fn main() {
    let started = Arc::new(AtomicUsize::new(0));
    let finished = Arc::new(AtomicUsize::new(0));
    let t0 = Instant::now();

    let started_for_events = started.clone();
    let finished_for_events = finished.clone();

    tauri::Builder::default()
        .setup(move |app| {
            let main = app
                .get_window("main")
                .ok_or_else(|| std::io::Error::other("missing main window"))?;

            let url: tauri::Url = std::env::args()
                .nth(1)
                .unwrap_or_else(|| "https://www.doubao.com".into())
                .parse()
                .expect("invalid url");

            println!("[repro] creating browser-panel webview for {url}");
            let mut builder = WebviewBuilder::new("browser-panel", WebviewUrl::External(url))
                .initialization_script(COMMENT_OVERLAY_SCRIPT)
                .on_page_load(move |_webview, payload| {
                        let elapsed = t0.elapsed().as_millis();
                        match payload.event() {
                            tauri::webview::PageLoadEvent::Started => {
                                let n = started_for_events.fetch_add(1, Ordering::SeqCst) + 1;
                                println!("[repro] +{elapsed:>6}ms STARTED  #{n} url={:?}", payload.url());
                            }
                            tauri::webview::PageLoadEvent::Finished => {
                                let n = finished_for_events.fetch_add(1, Ordering::SeqCst) + 1;
                                println!("[repro] +{elapsed:>6}ms FINISHED #{n} url={:?}", payload.url());
                            }
                        }
                    });
            // Mirror the production fix from commands/browser.rs: a browser-identified
            // UA prevents the baidu.com http/https redirect loop.
            builder = builder.user_agent(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
            );
            let webview = main.add_child(
                builder,
                LogicalPosition::new(200.0, 100.0),
                LogicalSize::new(800.0, 600.0),
            )?;
            webview.show()?;
            println!("[repro] webview created and shown");

            // Print a summary every 10 seconds; exit after 45 seconds.
            let started_for_timer = started.clone();
            let finished_for_timer = finished.clone();
            std::thread::spawn(move || {
                for tick in 1..=4 {
                    std::thread::sleep(Duration::from_secs(10));
                    println!(
                        "[repro] tick {tick}: started={} finished={}",
                        started_for_timer.load(Ordering::SeqCst),
                        finished_for_timer.load(Ordering::SeqCst)
                    );
                    if tick == 4 {
                        println!(
                            "[repro] FINAL: started={} finished={}",
                            started_for_timer.load(Ordering::SeqCst),
                            finished_for_timer.load(Ordering::SeqCst)
                        );
                        std::process::exit(0);
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
