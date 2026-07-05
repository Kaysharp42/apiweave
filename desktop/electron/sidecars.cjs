// Sidecar orchestration for the Electron desktop shell.
// At launch we allocate OS-assigned loopback ports,
// then spawn mongod, the FastAPI backend (uvicorn) and the worker as child
// processes bound to those ports. Each Child is pushed onto a shared array the
// main process kills on exit. boot() is async (it blocks ~15s waiting for
// mongod), so main can show the window immediately; the frontend BootGate polls
// backend health.
//
// Dev vs. frozen: commands resolve from env vars with dev-friendly defaults
// (backend venv python + a mongod on PATH). Packaged builds set
// APIWEAVE_SIDECAR_DIR and run the PyInstaller-frozen binaries + pinned mongod
// bundled as extraResources; the orchestration is identical either way.

const { spawn } = require("child_process");
const net = require("net");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/** Grab an OS-assigned free loopback port, then release it so a sidecar can
 * bind it. Narrow release→bind race is handled by mongod's spawn retry. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Poll a loopback port until something accepts a connection, or timeout. */
function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tryOnce = () => {
      const s = net.connect(port, "127.0.0.1");
      s.once("connect", () => {
        s.destroy();
        resolve(true);
      });
      s.once("error", () => {
        s.destroy();
        if (Date.now() > deadline) resolve(false);
        else setTimeout(tryOnce, 200);
      });
    };
    tryOnce();
  });
}

/** 32 random bytes, urlsafe-base64 — the format get_master_key() decodes and
 * the per-launch DESKTOP_UI_TOKEN shape the backend expects. */
function randomKey() {
  return crypto.randomBytes(32).toString("base64url");
}

// --- command resolution -----------------------------------------------------

function backendDir() {
  return (
    process.env.APIWEAVE_BACKEND_DIR ||
    path.resolve(__dirname, "../../backend")
  );
}

function pythonExe() {
  if (process.env.APIWEAVE_PYTHON) return process.env.APIWEAVE_PYTHON;
  // Prefer the backend's virtualenv interpreter (it has the deps) over a bare
  // system python, so `npm run dev` works without env setup.
  const dir = backendDir();
  for (const rel of [
    "venv/Scripts/python.exe",
    "venv/bin/python",
    ".venv/Scripts/python.exe",
    ".venv/bin/python",
  ]) {
    const candidate = path.join(dir, rel);
    if (fs.existsSync(candidate)) return candidate;
  }
  return "python";
}

function mongodExe() {
  return process.env.APIWEAVE_MONGOD || "mongod";
}

// Packaged builds set APIWEAVE_SIDECAR_DIR to the bundled resources/sidecars
// dir and run the PyInstaller-frozen binaries; dev falls back to the venv
// python + a mongod on PATH. Command builders return { cmd, args, cwd }.
function sidecarDir() {
  return process.env.APIWEAVE_SIDECAR_DIR || "";
}

function frozen(name) {
  return path.join(sidecarDir(), process.platform === "win32" ? `${name}.exe` : name);
}

function backendCmd(backendPort) {
  const args = ["--host", "127.0.0.1", "--port", String(backendPort)];
  return sidecarDir()
    ? { cmd: frozen("apiweave-backend"), args, cwd: undefined }
    : {
        cmd: pythonExe(),
        args: ["-m", "uvicorn", "app.main:app", ...args],
        cwd: backendDir(),
      };
}

function workerCmd() {
  return sidecarDir()
    ? { cmd: frozen("apiweave-worker"), args: [], cwd: undefined }
    : { cmd: pythonExe(), args: ["-m", "app.worker"], cwd: backendDir() };
}

function mongodCmd(dbpath, port) {
  return {
    cmd: sidecarDir() ? frozen("mongod") : mongodExe(),
    args: ["--dbpath", dbpath, "--port", String(port), "--bind_ip", "127.0.0.1"],
  };
}

// --- first-run secret persistence -------------------------------------------

/** Load persisted secrets, or generate + persist on first run. These must
 * survive restarts: a fresh SECRET_ENCRYPTION_KEY would orphan every stored
 * secret. A corrupt file is NOT silently overwritten (that would orphan too). */
function loadOrCreateSecrets(dir) {
  const p = path.join(dir, "runtime-secrets.json");
  let bytes;
  try {
    bytes = fs.readFileSync(p);
  } catch (e) {
    if (e.code !== "ENOENT") throw e; // permission/IO — surface, don't clobber
    const secrets = {
      secret_key: randomKey(),
      secret_encryption_key: randomKey(),
    };
    fs.writeFileSync(p, JSON.stringify(secrets, null, 2));
    return secrets;
  }
  try {
    return JSON.parse(bytes.toString());
  } catch (e) {
    throw new Error(
      `${p} is unreadable (${e.message}); refusing to regenerate keys and ` +
        `orphan stored secrets — restore or delete the file`,
    );
  }
}

// --- spawning ---------------------------------------------------------------

function backendEnv(secrets, mongoPort, backendPort, uiToken) {
  return {
    ...process.env,
    MONGODB_URL: `mongodb://127.0.0.1:${mongoPort}`,
    MONGODB_DB_NAME: "apiweave",
    BASE_URL: `http://127.0.0.1:${backendPort}`,
    // Only the webview is injected with this token; a browser hitting the
    // loopback port has no token and is rejected (except /mcp + /health).
    DESKTOP_UI_TOKEN: uiToken,
    // Origins that hit the backend cross-origin: the Vite dev server and the
    // app:// custom protocol the packaged renderer is served from.
    ALLOWED_ORIGINS:
      "app://local,http://localhost:3000,http://127.0.0.1:3000",
    DEPLOYMENT_MODE: "single_user",
    APP_ENV: "development",
    ALLOW_LOOPBACK: "true",
    SECRET_KEY: secrets.secret_key,
    SECRET_ENCRYPTION_KEY: secrets.secret_encryption_key,
  };
}

async function spawnMongod(dbpath, log, children) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    // mongod's port is internal (only backend/worker connect), so a bind race
    // here is safe to retry with a fresh port.
    const port = await freePort();
    const m = mongodCmd(dbpath, port);
    const child = spawn(m.cmd, m.args, { stdio: "ignore" });
    let exited = false;
    child.once("exit", () => {
      exited = true;
    });
    child.once("error", (e) => log(`mongod spawn error: ${e.message}`));
    // 30s, not 15s: first launch after install is exactly when antivirus scans
    // the freshly-unpacked 60MB+ mongod binary, which can delay its listen well
    // past a short window. A slow-but-alive mongod must not be given up on.
    if ((await waitForPort(port, 30000)) && !exited) {
      children.push(child);
      return port;
    }
    try {
      child.kill();
    } catch {
      /* already gone */
    }
    // Wait for the failed mongod to actually exit before respawning: it holds an
    // exclusive lock on the dbpath, so an immediate retry on the same path would
    // fail until the OS releases it.
    if (!exited) await new Promise((r) => child.once("exit", r));
    log(`mongod attempt ${attempt} did not open port ${port}; retrying`);
  }
  throw new Error("mongod failed to start after 3 attempts");
}

function spawnBackend(secrets, mongoPort, backendPort, uiToken, log, children) {
  // Port is fixed (already injected into the webview) — a dead backend surfaces
  // as the BootGate health-poll timeout, not a silent port mismatch.
  const b = backendCmd(backendPort);
  const child = spawn(b.cmd, b.args, {
    cwd: b.cwd,
    env: backendEnv(secrets, mongoPort, backendPort, uiToken),
    stdio: "inherit",
  });
  child.once("error", (e) => log(`backend spawn error: ${e.message}`));
  children.push(child);
}

function spawnWorker(secrets, mongoPort, backendPort, uiToken, log, children) {
  const w = workerCmd();
  const child = spawn(w.cmd, w.args, {
    cwd: w.cwd,
    env: backendEnv(secrets, mongoPort, backendPort, uiToken),
    stdio: "inherit",
  });
  child.once("error", (e) => log(`worker spawn error: ${e.message}`));
  children.push(child);
}

/** Bring up mongod → backend → worker, pushing each Child onto the shared
 * `children` array as it spawns (so the exit handler kills even those started
 * before a mid-sequence failure). */
async function boot(appDataDir, backendPort, uiToken, log, children) {
  fs.mkdirSync(appDataDir, { recursive: true });
  const dbpath = path.join(appDataDir, "mongo");
  fs.mkdirSync(dbpath, { recursive: true });
  const secrets = loadOrCreateSecrets(appDataDir);

  const mongoPort = await spawnMongod(dbpath, log, children);
  spawnBackend(secrets, mongoPort, backendPort, uiToken, log, children);
  spawnWorker(secrets, mongoPort, backendPort, uiToken, log, children);
}

module.exports = { freePort, randomKey, boot };
