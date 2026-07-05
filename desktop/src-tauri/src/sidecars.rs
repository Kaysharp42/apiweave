//! Sidecar orchestration for the desktop app.
//!
//! At launch we allocate OS-assigned loopback ports, then spawn `mongod`, the
//! FastAPI backend (uvicorn) and the worker as child processes bound to those
//! ports. Nothing is hardcoded, so the app never collides with a user's own
//! services on 3000/8000/8080/27017. Each spawned `Child` is appended to a
//! shared list the app kills on exit. `boot()` runs on a background thread so
//! the window can appear immediately.
//!
//! Dev vs. frozen binaries: the backend/worker/mongod commands are resolved
//! from env vars with dev-friendly defaults (system `python`/`mongod`, backend
//! sources next to this crate). Phase 3 (PyInstaller freeze) swaps those
//! defaults for the bundled sidecar binaries — the orchestration here is
//! unchanged.

use std::io;
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;

/// Grab an OS-assigned free loopback port, then release it so a sidecar can
/// bind it. There is a narrow race between release and the sidecar's own bind
/// (something else could grab the port) — spawners treat an immediate exit as
/// that race and retry with a fresh port.
pub fn free_port() -> io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    Ok(listener.local_addr()?.port())
}

/// Poll a loopback port until something accepts a connection, or timeout.
fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

// --- command resolution -----------------------------------------------------
//
// Debug (`tauri dev`): run the sources with the backend's venv python + a
// `mongod` on PATH. Release (`tauri build`): run the PyInstaller-frozen
// sidecars that Tauri drops next to the app executable (built by
// scripts/build-desktop-sidecars).

#[cfg(debug_assertions)]
fn python() -> String {
    if let Ok(p) = std::env::var("APIWEAVE_PYTHON") {
        return p;
    }
    // Prefer the backend's virtualenv interpreter (it has the deps) over a bare
    // system `python`, so `tauri dev` works without any env setup.
    let dir = backend_dir();
    for rel in ["venv/Scripts/python.exe", "venv/bin/python", ".venv/Scripts/python.exe", ".venv/bin/python"] {
        let candidate = dir.join(rel);
        if candidate.exists() {
            return candidate.to_string_lossy().into_owned();
        }
    }
    "python".into()
}

#[cfg(debug_assertions)]
fn backend_dir() -> PathBuf {
    std::env::var("APIWEAVE_BACKEND_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../backend")))
}

#[cfg(not(debug_assertions))]
fn sidecar_path(name: &str) -> PathBuf {
    // Tauri installs externalBin alongside the app executable, triple suffix stripped.
    let dir = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(Path::to_path_buf))
        .unwrap_or_default();
    let file = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
    dir.join(file)
}

fn mongod_command(dbpath: &Path, port: u16) -> Command {
    #[cfg(debug_assertions)]
    let mut cmd = Command::new(std::env::var("APIWEAVE_MONGOD").unwrap_or_else(|_| "mongod".into()));
    #[cfg(not(debug_assertions))]
    let mut cmd = Command::new(sidecar_path("mongod"));
    cmd.args([
        "--dbpath",
        &dbpath.to_string_lossy(),
        "--port",
        &port.to_string(),
        "--bind_ip",
        "127.0.0.1",
    ]);
    cmd
}

fn backend_command(port: u16) -> Command {
    #[cfg(debug_assertions)]
    let cmd = {
        let mut c = Command::new(python());
        c.current_dir(backend_dir()).args([
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
        ]);
        c
    };
    #[cfg(not(debug_assertions))]
    let cmd = {
        let mut c = Command::new(sidecar_path("apiweave-backend"));
        c.args(["--host", "127.0.0.1", "--port", &port.to_string()]);
        c
    };
    cmd
}

fn worker_command() -> Command {
    #[cfg(debug_assertions)]
    let cmd = {
        let mut c = Command::new(python());
        c.current_dir(backend_dir()).args(["-m", "app.worker"]);
        c
    };
    #[cfg(not(debug_assertions))]
    let cmd = Command::new(sidecar_path("apiweave-worker"));
    cmd
}

// --- first-run secret persistence -----------------------------------------

#[derive(serde::Serialize, serde::Deserialize)]
struct Secrets {
    secret_key: String,
    // urlsafe-base64 of 32 raw bytes — the exact format get_master_key() decodes.
    secret_encryption_key: String,
}

fn random_key() -> String {
    let mut buf = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

/// Load persisted secrets, or generate + persist them on first run. These must
/// survive restarts: a fresh SECRET_ENCRYPTION_KEY would make every previously
/// stored secret undecryptable.
fn load_or_create_secrets(dir: &Path) -> io::Result<Secrets> {
    let path = dir.join("runtime-secrets.json");
    match std::fs::read(&path) {
        Ok(bytes) => serde_json::from_slice::<Secrets>(&bytes).map_err(|e| {
            // Only a genuinely-missing file is "first run". A corrupt/unparseable
            // file must NOT be silently overwritten with fresh keys — that would
            // permanently orphan every secret already encrypted under the old key.
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!(
                    "{} is unreadable ({e}); refusing to regenerate keys and orphan stored secrets — restore or delete the file",
                    path.display()
                ),
            )
        }),
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            let secrets = Secrets {
                secret_key: random_key(),
                secret_encryption_key: random_key(),
            };
            std::fs::write(&path, serde_json::to_vec_pretty(&secrets)?)?;
            Ok(secrets)
        }
        // Transient errors (permission denied, I/O) — surface, don't clobber.
        Err(e) => Err(e),
    }
}

// --- spawning ---------------------------------------------------------------

fn apply_backend_env(cmd: &mut Command, secrets: &Secrets, mongo_port: u16, backend_port: u16) {
    cmd.env("MONGODB_URL", format!("mongodb://127.0.0.1:{mongo_port}"))
        .env("MONGODB_DB_NAME", "apiweave")
        .env("BASE_URL", format!("http://127.0.0.1:{backend_port}"))
        // Webview origins that hit the backend cross-origin: Vite dev server in
        // `tauri dev`, and the tauri:// custom protocol in a bundled build.
        .env(
            "ALLOWED_ORIGINS",
            "http://localhost:3000,http://127.0.0.1:3000,tauri://localhost,https://tauri.localhost,http://tauri.localhost",
        )
        .env("DEPLOYMENT_MODE", "single_user")
        .env("APP_ENV", "development")
        .env("ALLOW_LOOPBACK", "true")
        .env("SECRET_KEY", &secrets.secret_key)
        .env("SECRET_ENCRYPTION_KEY", &secrets.secret_encryption_key);
}

fn track(children: &Mutex<Vec<Child>>, child: Child) {
    children.lock().unwrap().push(child);
}

fn spawn_mongod(dbpath: &Path, children: &Mutex<Vec<Child>>) -> Result<u16, String> {
    for attempt in 1..=3 {
        // mongod's port is internal (only the backend/worker connect to it), so a
        // bind race here is safe to retry with a fresh port.
        let port = free_port().map_err(|e| e.to_string())?;
        match mongod_command(dbpath, port).spawn() {
            Ok(mut child) => {
                if wait_for_port(port, Duration::from_secs(15)) {
                    track(children, child);
                    return Ok(port);
                }
                let _ = child.kill();
                log::warn!("mongod attempt {attempt} did not open port {port}; retrying");
            }
            Err(e) => return Err(format!("failed to launch mongod: {e}")),
        }
    }
    Err("mongod failed to start after 3 attempts".into())
}

fn spawn_backend(
    secrets: &Secrets,
    mongo_port: u16,
    backend_port: u16,
    children: &Mutex<Vec<Child>>,
) -> Result<(), String> {
    // The frontend was already told this port via the injected runtime script, so
    // it's fixed (no reallocation) — a dead backend surfaces as the boot gate's
    // health-poll timeout rather than a silent port mismatch.
    let mut cmd = backend_command(backend_port);
    apply_backend_env(&mut cmd, secrets, mongo_port, backend_port);
    let child = cmd
        .spawn()
        .map_err(|e| format!("failed to launch backend: {e}"))?;
    track(children, child);
    Ok(())
}

fn spawn_worker(
    secrets: &Secrets,
    mongo_port: u16,
    backend_port: u16,
    children: &Mutex<Vec<Child>>,
) -> Result<(), String> {
    let mut cmd = worker_command();
    apply_backend_env(&mut cmd, secrets, mongo_port, backend_port);
    let child = cmd
        .spawn()
        .map_err(|e| format!("failed to launch worker: {e}"))?;
    track(children, child);
    Ok(())
}

/// Bring up mongod → backend → worker, appending each `Child` to `children` as
/// it spawns. Runs on a background thread (it blocks up to ~15s waiting for
/// mongod), so the app window can appear immediately; the frontend boot gate
/// waits on backend health. Children spawned before a mid-sequence failure stay
/// tracked so the exit handler still kills them.
pub fn boot(
    app_data_dir: &Path,
    backend_port: u16,
    children: &Mutex<Vec<Child>>,
) -> Result<(), String> {
    std::fs::create_dir_all(app_data_dir).map_err(|e| e.to_string())?;
    let dbpath = app_data_dir.join("mongo");
    std::fs::create_dir_all(&dbpath).map_err(|e| e.to_string())?;
    let secrets = load_or_create_secrets(app_data_dir).map_err(|e| e.to_string())?;

    let mongo_port = spawn_mongod(&dbpath, children)?;
    spawn_backend(&secrets, mongo_port, backend_port, children)?;
    spawn_worker(&secrets, mongo_port, backend_port, children)?;
    Ok(())
}
