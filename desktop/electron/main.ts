import { app, BrowserWindow, ipcMain, net, protocol } from "electron"
import path from "node:path"
import { pathToFileURL } from "node:url"

const DEV_SERVER_URL = "http://localhost:5173"

if (process.platform === "linux") {
  app.commandLine.appendSwitch("ozone-platform-hint", "auto")
}

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

let mainWindow: BrowserWindow | null = null

function frontendDistDir(): string {
  if (process.env["APIWEAVE_FRONTEND_DIST"]) {
    return process.env["APIWEAVE_FRONTEND_DIST"]
  }

  return app.isPackaged
    ? path.join(process.resourcesPath, "frontend")
    : path.resolve(app.getAppPath(), "../frontend/dist")
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    backgroundColor: "#0b0b0f",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow = win

  ipcMain.on("window:minimize", () => win.minimize())
  ipcMain.on("window:toggleMaximize", () => {
    if (win.isMaximized()) {
      win.unmaximize()
      return
    }

    win.maximize()
  })
  ipcMain.on("window:close", () => win.close())

  win.on("maximize", () => win.webContents.send("window:maximizeChanged", true))
  win.on("unmaximize", () => win.webContents.send("window:maximizeChanged", false))
  win.on("closed", () => {
    mainWindow = null
  })

  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`[renderer] did-fail-load ${code} ${description} ${url}`)
  })
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("[renderer] render-process-gone", details)
  })

  try {
    const rendererUrl = app.isPackaged ? "app://local/" : DEV_SERVER_URL
    await win.loadURL(rendererUrl)
    console.info(`[renderer] loaded ${rendererUrl}`)
  } catch (error) {
    if (error instanceof Error) {
      console.error(`[renderer] load failed: ${error.message}`)
      return
    }

    throw error
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
console.info(`[bootstrap] single-instance-lock=${hasSingleInstanceLock}`)

if (!hasSingleInstanceLock) {
  console.info("[bootstrap] second instance rejected; quitting")
  app.quit()
} else {
  app.on("second-instance", () => {
    console.info("[bootstrap] second-instance event; focusing existing window")

    if (mainWindow === null) {
      return
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }

    mainWindow.focus()
  })

  app.whenReady().then(() => {
    protocol.handle("app", (request) => {
      let pathname = decodeURIComponent(new URL(request.url).pathname)

      if (pathname === "/" || pathname === "" || !path.extname(pathname)) {
        pathname = "/index.html"
      }

      return net.fetch(pathToFileURL(path.join(frontendDistDir(), pathname)).toString())
    })

    void createWindow()

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow()
      }
    })
  })
}

app.on("window-all-closed", () => {
  app.quit()
})
