import { app, BrowserWindow, ipcMain, net, protocol } from "electron"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { IpcRouter, attachIpcRouter } from "../core/ipc/index"
import { emitRunProgress } from "../core/ipc/register"
import { registerAllHandlers, type HandlerDeps } from "../core/ipc/handlers"
import { canonicalizeExistingWorkflows } from "../core/db/canonicalize_existing_workflows"
import { initDatabase, type InitializedDatabase } from "../core/db"
import {
  CollectionRepository,
  EnvironmentRepository,
  RunRepository,
  SecretRepository,
  WorkflowRepository,
  WorkspaceRepository,
} from "../core/repositories"
import { createKeyfile, readKeyfile, keyfileExists } from "../core/secrets/keyfile"
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
  ImportService,
} from "../core/services"
import { LocalOwnerProvider } from "../core/auth"
import { LocalOnlySyncProvider, SwitchableSyncProvider } from "../core/sync"
import { RunScheduler, SafeHttp, DynamicFunctions } from "../core/runner"
import { WallClockProvider, CryptoRandomProvider } from "../core/runner/harness/providers"
import { McpHost } from "../core/mcp"
import { MCP_TOOLS, toolName } from "../core/mcp/tools"
import type { McpStatus } from "../../shared/types/McpStatus"
import type { MCPTool } from "../../shared/types/MCPTool"
import { cloudDefaults, DesktopCloudSyncControl } from "./cloud/cloud-sync-control"
import { registerConflictUiHandlers } from "./cloud/conflict-ui-bridge"
import { CLOUD_STATUS_CHANGED_CHANNEL } from "../core/ipc/channels"

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
    // One-shot in-place rewrite: any workflow row persisted before the
    // strict canonical-node schema landed is rewritten so its http-request
    // KV fields (headers/cookies/queryParams/pathVariables) become
    // `KeyValuePair[]`. Idempotent — rows already canonical are skipped, so
    // running on every startup costs only the graph_json read of (tens to
    // hundreds of) workflow rows.
    const canonicalised = canonicalizeExistingWorkflows(database.kvStore)
    if (canonicalised > 0) {
      console.info(`[bootstrap] canonicalised ${canonicalised} workflow graph(s) to KeyValuePair[] form`)
    }

    // Repositories — the only DB touchpoint.
    const workspaces = new WorkspaceRepository(database.kvStore)
    const workflows = new WorkflowRepository(database.kvStore)
    const runs = new RunRepository(database.kvStore)
    const environments = new EnvironmentRepository(database.kvStore)
    const collections = new CollectionRepository(database.kvStore)
    const secretStore = new SecretRepository(database.kvStore)

    // Auth + sync seams: single-owner always-allow, local-only no-op.
    const existence: ScopeExistence = {
      workspaceExists: (id) => workspaces.getById(id) !== undefined,
      environmentExists: (id) => environments.getById(id) !== undefined,
    }
    const scopeResolver = new ScopeResolver(existence)
    const permissions = new LocalOwnerProvider()
    const sync = new SwitchableSyncProvider(new LocalOnlySyncProvider())

    // Keyfile: the persisted master KEK that deterministically derives the
    // sealed-box private seed. Seeded once on first run; read thereafter. Lose
    // it and every stored secret is orphaned (intentional — never auto-regenerate).
    const keyfilePath = path.join(app.getPath("userData"), "keyfile.json")
    const keyfile = keyfileExists(keyfilePath) ? readKeyfile(keyfilePath) : createKeyfile(keyfilePath)
    const secretService = new SecretService(secretStore, sync, permissions, scopeResolver, keyfile.masterKek)
    const cloud = new DesktopCloudSyncControl({
      store: database.kvStore,
      keyfilePath,
      defaults: cloudDefaults(app.getVersion()),
      setSyncProviderTarget: (provider) => sync.setTarget(provider),
      onStatusChanged: () => {
        if (mainWindow !== null && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(CLOUD_STATUS_CHANGED_CHANNEL)
        }
      },
    })

    // Runner: in-process scheduler drives the executor.
    const clock = new WallClockProvider()
    const rng = new CryptoRandomProvider()
    const http = new SafeHttp({ allowLoopback: true })
    const functions = new DynamicFunctions(clock, rng)
    scheduler = new RunScheduler({
      runs,
      workflows,
      environments,
      http,
      functions,
      clock,
      rng,
      resolveSecret: (name, chain) => secretService.resolvePlaintext(name, chain),
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

    // Services over the scoped repos; RunService drives the scheduler so
    // runs.create actually executes and runs.cancel aborts a live run.
    const deps: HandlerDeps = {
      workspaces: new WorkspaceService(workspaces, sync, scopeResolver),
      collections: new CollectionService(collections, workflows, sync, permissions, scopeResolver),
      workflows: new WorkflowService(workflows, sync, permissions, scopeResolver, collections, environments),
      environments: new EnvironmentService(environments, sync, permissions, scopeResolver),
      runs: new RunService(runs, sync, permissions, scopeResolver, scheduler),
      secrets: secretService,
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
      imports: new ImportService(workflows, environments, collections, sync, permissions, scopeResolver),
      cloud,
    }
    registerAllHandlers(ipcRouter, deps)
    // Conflict/loser-retrieval IPC lives in a separate bridge (repository-backed
    // reads plus a server-side resolve for conflicts that have a cloud ID). The
    // renderer's conflict pages already call cloud.conflict-* — without this the
    // actions are unregistered.
    registerConflictUiHandlers(ipcRouter, {
      store: database.kvStore,
      syncService: cloud.getConflictResolver(),
    })

    attachIpcRouter(ipcMain, ipcRouter)

    // MCP server control. Off until enabled, but the user's choice is persisted
    // (app_settings.mcp_enabled) so it auto-starts on the next launch. The host
    // exposes the SAME `ipcRouter` as a second (loopback-HTTP) transport, so its
    // tool surface is whatever handlers are registered on the router — no
    // separate tool stack. The per-install token is already persisted, so
    // re-enabling reuses it.
    const mcpTokenPath = path.join(app.getPath("userData"), "mcp-token")
    const mcpStatus = (): McpStatus => ({
      running: mcpHost?.isRunning() ?? false,
      config: mcpHost?.getConfig() ?? null,
    })
    const readMcpEnabled = (): boolean => {
      if (database === null) return false
      const row = database.kvStore.get<{ value: string }>(
        "SELECT value FROM app_settings WHERE key = 'mcp.enabled'",
      )
      return row?.value === "true"
    }
    const writeMcpEnabled = (enabled: boolean): void => {
      if (database === null) return
      database.kvStore.set(
        "INSERT INTO app_settings (key, value) VALUES ('mcp.enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [enabled ? "true" : "false"],
      )
    }
    ipcMain.handle("mcp:getStatus", () => mcpStatus())
    ipcMain.handle("mcp:enable", async () => {
      if (mcpHost === null) {
        mcpHost = new McpHost({ router: ipcRouter, tokenFilePath: mcpTokenPath, version: app.getVersion() })
      }
      await mcpHost.start()
      writeMcpEnabled(true)
      return mcpStatus()
    })
    ipcMain.handle("mcp:disable", async () => {
      await mcpHost?.stop()
      writeMcpEnabled(false)
      return mcpStatus()
    })
    ipcMain.handle("mcp:listTools", (): readonly MCPTool[] =>
      MCP_TOOLS.map((spec) => ({ name: toolName(spec), description: spec.description })),
    )

    // Restore the user's persisted MCP choice on launch.
    if (readMcpEnabled()) {
      mcpHost = new McpHost({ router: ipcRouter, tokenFilePath: mcpTokenPath, version: app.getVersion() })
      void mcpHost
        .start()
        .then(() => console.info("[mcp] auto-started local MCP server from persisted setting"))
        .catch((error: unknown) => {
          console.error(`[mcp] auto-start failed: ${error instanceof Error ? error.message : String(error)}`)
          mcpHost = null
        })
    }

    protocol.handle("app", async (request) => {
      let pathname = decodeURIComponent(new URL(request.url).pathname)

      if (pathname === "/" || pathname === "" || !path.extname(pathname)) {
        pathname = "/index.html"
      }

      const response = await net.fetch(
        pathToFileURL(path.join(frontendDistDir(), pathname)).toString(),
      )
      // Local files behind a privileged scheme get heuristically cached by
      // Electron, pinning index.html to stale asset hashes after a rebuild
      // ("restarted dev, UI didn't change"). Reading from disk is cheap, so
      // never cache.
      const headers = new Headers(response.headers)
      headers.set("Cache-Control", "no-store")
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
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
