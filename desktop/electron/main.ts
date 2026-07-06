import { app, BrowserWindow, ipcMain, net, protocol } from "electron"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { IpcRouter, attachIpcRouter } from "../core/ipc/index"
import { emitRunProgress } from "../core/ipc/register"
import { initDatabase, type InitializedDatabase } from "../core/db"
import { RunRepository, WorkflowRepository } from "../core/repositories"
import { RunScheduler, SafeHttp, DynamicFunctions } from "../core/runner"
import { WallClockProvider, CryptoRandomProvider } from "../core/runner/harness/providers"
import { McpHost } from "../core/mcp"
import type { McpStatus } from "../../shared/types/McpStatus"

// The single request channel. Handlers are registered onto it in Task 13; until
// then every `apiweave:invoke` call returns a not_found envelope, which is the
// correct answer while the GUI is intentionally offline (Waves 1–3).
const ipcRouter = new IpcRouter()

let database: InitializedDatabase | null = null
let scheduler: RunScheduler | null = null
let mcpHost: McpHost | null = null
let isQuitting = false

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
    database = initDatabase({ userDataPath: app.getPath("userData") })

    const runs = new RunRepository(database.kvStore)
    const workflows = new WorkflowRepository(database.kvStore)
    const clock = new WallClockProvider()
    const rng = new CryptoRandomProvider()
    const http = new SafeHttp({ allowLoopback: true })
    const functions = new DynamicFunctions(clock, rng)
    scheduler = new RunScheduler({
      runs,
      workflows,
      http,
      functions,
      clock,
      rng,
      emitProgress: (_runId, event) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          emitRunProgress(mainWindow.webContents, event)
        }
      },
    })

    const interrupted = scheduler.reconcileOnStartup()
    if (interrupted > 0) {
      console.info(`[bootstrap] reconciled ${interrupted} stuck run(s) to interrupted`)
    }

    attachIpcRouter(ipcMain, ipcRouter)

    // MCP server control (opt-in, off by default). The host exposes the SAME
    // `ipcRouter` as a second (loopback-HTTP) transport, so its tool surface is
    // whatever handlers are registered on the router — no separate tool stack.
    // ponytail: enabled-state is not persisted across restarts (decision #5:
    // off by default); the per-install token IS persisted, so re-enabling reuses it.
    const mcpTokenPath = path.join(app.getPath("userData"), "mcp-token")
    const mcpStatus = (): McpStatus => ({
      running: mcpHost?.isRunning() ?? false,
      config: mcpHost?.getConfig() ?? null,
    })
    ipcMain.handle("mcp:getStatus", () => mcpStatus())
    ipcMain.handle("mcp:enable", async () => {
      if (mcpHost === null) {
        mcpHost = new McpHost({ router: ipcRouter, tokenFilePath: mcpTokenPath, version: app.getVersion() })
      }
      await mcpHost.start()
      return mcpStatus()
    })
    ipcMain.handle("mcp:disable", async () => {
      await mcpHost?.stop()
      return mcpStatus()
    })

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

app.on("before-quit", (event) => {
  if (isQuitting) return
  isQuitting = true

  void mcpHost?.stop()
  mcpHost = null

  if (scheduler && scheduler.getActiveCount() > 0) {
    event.preventDefault()
    void scheduler.shutdown(2000).finally(() => {
      database?.close()
      database = null
      app.quit()
    })
    return
  }

  database?.close()
  database = null
})
