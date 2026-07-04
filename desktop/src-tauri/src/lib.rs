mod sidecars;

use std::sync::{Arc, Mutex};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

/// Sidecar `Child` handles, killed when the app exits. Shared with the boot
/// thread, which appends to it as each process spawns.
struct SidecarChildren(Arc<Mutex<Vec<std::process::Child>>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Allocate the backend port now (instant) so it can be injected before
            // the window loads. The sidecars that actually bind it come up on a
            // background thread, so the window appears immediately and the
            // frontend boot gate waits on backend health.
            let backend_port = sidecars::free_port()?;
            let api_url = format!("http://127.0.0.1:{backend_port}");

            // APIWEAVE_SKIP_SIDECARS renders the shell without the stack (CI render
            // smoke test / UI-only runs); API calls just fail.
            if std::env::var_os("APIWEAVE_SKIP_SIDECARS").is_some() {
                log::warn!("APIWEAVE_SKIP_SIDECARS set — not spawning sidecars");
            } else {
                let children = Arc::new(Mutex::new(Vec::new()));
                app.manage(SidecarChildren(children.clone()));
                let data_dir = app.path().app_data_dir()?;
                std::thread::spawn(move || {
                    if let Err(e) = sidecars::boot(&data_dir, backend_port, &children) {
                        log::error!("sidecar boot failed: {e}");
                    }
                });
            }

            // Injected before any bundled JS runs, so `utils/api.ts` can read the
            // backend port synchronously from window.__APIWEAVE_RUNTIME__.
            let script = format!(
                "window.__APIWEAVE_RUNTIME__ = {{ apiUrl: {} }};",
                serde_json::to_string(&api_url)?
            );
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("APIWeave")
                .inner_size(1280.0, 800.0)
                .min_inner_size(960.0, 600.0)
                .initialization_script(&script)
                .build()?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app_handle.try_state::<SidecarChildren>() {
                    for mut child in state.0.lock().unwrap().drain(..) {
                        let _ = child.kill();
                    }
                }
            }
        });
}
