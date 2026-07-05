// Electron main process — the cross-platform desktop shell.
// It creates a frameless window (the frontend draws its own TitleBar), serves
// the built React app over an app:// custom protocol (so absolute asset paths
// and client-side routing work), and orchestrates the local sidecars
// (mongod/backend/worker) via sidecars.cjs. The backend port + per-launch token
// are injected into the renderer through the preload's additionalArguments.

const { app, BrowserWindow, ipcMain, protocol, net: enet } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");
const sidecars = require("./sidecars.cjs");

// Dev: point at the Vite dev server (APIWEAVE_DEV_SERVER=http://localhost:3000).
// Prod/no dev server: serve the built frontend from disk over app://.
const DEV_SERVER = process.env.APIWEAVE_DEV_SERVER || "";
// Packaged builds ship the frontend + frozen sidecars under the app's resources
// dir (see electron-builder `extraResources` in package.json); dev reads the repo.
const DIST_DIR =
  process.env.APIWEAVE_FRONTEND_DIST ||
  (app.isPackaged
    ? path.join(process.resourcesPath, "frontend")
    : path.resolve(__dirname, "../../frontend/dist"));
if (app.isPackaged && !process.env.APIWEAVE_SIDECAR_DIR) {
  process.env.APIWEAVE_SIDECAR_DIR = path.join(process.resourcesPath, "sidecars");
}

// Shared with the sidecar boot thread, which pushes each Child as it spawns.
const children = [];

// Prefer native Wayland when available (falls back to X11/XWayland) — Chromium's
// Ozone Wayland support is the reason this app is on Electron. Must run before ready.
if (process.platform === "linux") {
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
}

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function killChildren() {
  for (const c of children.splice(0)) {
    try {
      c.kill();
    } catch {
      /* already gone */
    }
  }
}

async function createWindow() {
  // Allocate the backend port now (instant) so it can be injected before the
  // window loads. The sidecars that bind it come up in the background, so the
  // window appears immediately and the BootGate waits on backend health.
  const backendPort = await sidecars.freePort();
  const apiUrl = `http://127.0.0.1:${backendPort}`;
  // Per-launch token shared only with the renderer: the backend rejects any
  // request without it (except /mcp + /health), so a browser on the loopback
  // port can't use the app while single_user auth is off.
  const uiToken = sidecars.randomKey();
  const runtime = Buffer.from(JSON.stringify({ apiUrl, uiToken })).toString("base64");

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    frame: false, // frontend draws its own title bar (components/layout/TitleBar.tsx)
    backgroundColor: "#0b0b0f",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--apiweave-runtime=${runtime}`],
    },
  });

  // Surface renderer load failures — otherwise they show only as a blank window.
  win.webContents.on("did-finish-load", () => console.log("[renderer] loaded"));
  win.webContents.on("did-fail-load", (_e, code, desc, url) =>
    console.error(`[renderer] did-fail-load ${code} ${desc} ${url}`),
  );
  win.webContents.on("render-process-gone", (_e, details) =>
    console.error("[renderer] render-process-gone", details),
  );

  // Window controls the frameless TitleBar drives over IPC.
  ipcMain.on("window:minimize", () => win.minimize());
  ipcMain.on("window:toggleMaximize", () =>
    win.isMaximized() ? win.unmaximize() : win.maximize(),
  );
  ipcMain.on("window:close", () => win.close());
  win.on("maximize", () => win.webContents.send("window:maximizeChanged", true));
  win.on("unmaximize", () => win.webContents.send("window:maximizeChanged", false));

  if (process.env.APIWEAVE_SKIP_SIDECARS) {
    // Render the shell without the stack (UI-only / CI smoke runs); API calls fail.
    console.warn("APIWEAVE_SKIP_SIDECARS set — not spawning sidecars");
  } else {
    sidecars
      .boot(app.getPath("userData"), backendPort, uiToken, (m) => console.log("[sidecars]", m), children)
      .catch((e) => console.error("sidecar boot failed:", e));
  }

  // Load the ROOT (not /index.html) so React Router sees pathname "/" and runs
  // the desktop → /app redirect; /index.html would fall through to the 404 route.
  // The app:// handler maps "/" to index.html.
  if (DEV_SERVER) await win.loadURL(DEV_SERVER);
  else await win.loadURL("app://local/");
}

app.whenReady().then(() => {
  if (!DEV_SERVER) {
    protocol.handle("app", (req) => {
      let p = decodeURIComponent(new URL(req.url).pathname);
      // SPA fallback: extensionless paths are client-side routes → index.html.
      if (p === "/" || p === "" || !path.extname(p)) p = "/index.html";
      return enet.fetch(pathToFileURL(path.join(DIST_DIR, p)).toString());
    });
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  killChildren();
  app.quit();
});
app.on("before-quit", killChildren);
