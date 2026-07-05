// Preload — the only bridge between the sandboxed renderer and the main process.
// Injects the runtime (backend apiUrl + per-launch token) the frontend reads
// synchronously via window.__APIWEAVE_RUNTIME__, and exposes the frameless
// window controls the custom TitleBar drives.

const { contextBridge, ipcRenderer } = require("electron");

const arg = process.argv.find((a) => a.startsWith("--apiweave-runtime="));
const runtime = arg
  ? JSON.parse(Buffer.from(arg.slice("--apiweave-runtime=".length), "base64").toString())
  : {};

// Same shape the old Tauri init script injected, so utils/api.ts and the
// desktop-detection gates keep working unchanged.
contextBridge.exposeInMainWorld("__APIWEAVE_RUNTIME__", runtime);

contextBridge.exposeInMainWorld("__APIWEAVE_DESKTOP__", {
  minimize: () => ipcRenderer.send("window:minimize"),
  toggleMaximize: () => ipcRenderer.send("window:toggleMaximize"),
  close: () => ipcRenderer.send("window:close"),
  // Returns an unsubscribe fn. Fires true on maximize, false on unmaximize.
  onMaximizeChange: (cb) => {
    const handler = (_e, value) => cb(value);
    ipcRenderer.on("window:maximizeChanged", handler);
    return () => ipcRenderer.removeListener("window:maximizeChanged", handler);
  },
});
