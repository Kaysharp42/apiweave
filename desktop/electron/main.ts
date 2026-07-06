import { app, BrowserWindow, ipcMain, net, protocol } from "electron"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { IpcRouter, attachIpcRouter } from "../core/ipc/index"
import { emitRunProgress } from "../core/ipc/register"
import { registerAllHandlers, type HandlerDeps } from "../core/ipc/handlers"
import { initDatabase, type InitializedDatabase } from "../core/db"
import {
  CollectionRepository,
  EnvironmentRepository,
  RunRepository,
  SecretRepository,
  WorkflowRepository,
  WorkspaceRepository,
} from "../core/repositories"
import {
  ScopeResolver,
  type ScopeExistence,
  WorkspaceService,
  CollectionService,
  WorkflowService,
  EnvironmentService,
  RunService,
  SecretService,
  ProjectExportService,
} from "../core/services"
import { LocalOwnerProvider } from "../core/auth"
import { LocalOnlySyncProvider } from "../core/sync"
import { RunScheduler, SafeHttp, DynamicFunctions } from "../core/runner"
import { WallClockProvider, CryptoRandomProvider } from "../core/runner/harness/providers"
import { McpHost } from "../core/mcp"
import type { McpStatus } from "../../shared/types/McpStatus"

// The single request channel. The composition root (whenReady) constructs the
// services and calls registerAllHandlers onto it before attaching; the MCP host
// exposes the same router as a second transport.
const ipcRouter = new IpcRouter()

let database: InitializedDatabase | null = null
let scheduler: RunScheduler | null = null
let mcpHost: McpHost | null = null
let isQuitting = false

// Optional Vite dev server (frontend `npm run dev`) — port 3000 per frontend/vite.config.
const DEV_SERVER_URL = "http://localhost:3000"

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
    const serveStatic = app.isPackaged || process.env["APIWEAVE_USE_VITE"] !== "1"
    const rendererUrl = serveStatic ? "app://local/" : DEV_SERVER_URL
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

    // Repositories — the only DB touchpoint.
    const workspaces = new WorkspaceRepository(database.kvStore)
    const workflows = new WorkflowRepository(database.kvStore)
    const runs = new RunRepository(database.kvStore)
    const environments = new EnvironmentRepository(database.kvStore)
    const collections = new CollectionRepository(database.kvStore)
    const secretStore = new SecretRepository(database.kvStore)

    // Runner: in-process scheduler drives the executor.
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

    // Auth + sync seams: single-owner always-allow, local-only no-op.
    const existence: ScopeExistence = {
      workspaceExists: (id) => workspaces.getById(id) !== undefined,
      environmentExists: (id) => environments.getById(id) !== undefined,
    }
    const scopeResolver = new ScopeResolver(existence)
    const permissions = new LocalOwnerProvider()
    const sync = new LocalOnlySyncProvider()

    // Services over the scoped repos; RunService drives the scheduler so
    // runs.create actually executes and runs.cancel aborts a live run.
    const deps: HandlerDeps = {
      workspaces: new WorkspaceService(workspaces, sync, scopeResolver),
      collections: new CollectionService(collections, workflows, sync, permissions, scopeResolver),
      workflows: new WorkflowService(workflows, sync, permissions, scopeResolver, collections, environments),
      environments: new EnvironmentService(environments, sync, permissions, scopeResolver),
      runs: new RunService(runs, sync, permissions, scopeResolver, scheduler),
      secrets: new SecretService(secretStore, sync, permissions, scopeResolver),
      projects: new ProjectExportService(
        collections,
        workflows,
        environments,
        sync,
        permissions,
        scopeResolver,
        secretStore,
        () => clock.isoNow(),
      ),
    }
    registerAllHandlers(ipcRouter, deps)

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
