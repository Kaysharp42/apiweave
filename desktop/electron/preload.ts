import { contextBridge, ipcRenderer } from "electron"

type DesktopBridge = {
  readonly minimize: () => void
  readonly toggleMaximize: () => void
  readonly close: () => void
  readonly onMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void
}

const desktopBridge: DesktopBridge = {
  minimize: () => ipcRenderer.send("window:minimize"),
  toggleMaximize: () => ipcRenderer.send("window:toggleMaximize"),
  close: () => ipcRenderer.send("window:close"),
  onMaximizeChange: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: boolean): void => {
      callback(value)
    }

    ipcRenderer.on("window:maximizeChanged", handler)
    return () => ipcRenderer.removeListener("window:maximizeChanged", handler)
  },
}

contextBridge.exposeInMainWorld("__APIWEAVE_DESKTOP__", desktopBridge)
