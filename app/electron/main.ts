import { app, BrowserWindow, ipcMain, net, protocol, shell } from "electron"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { IpcRouter, attachIpcRouter } from "../core/ipc/index"
import { emitRunProgress, isTrustedSender } from "../core/ipc/register"
import { registerAllHandlers, type HandlerDeps } from "../core/ipc/handlers"
import { canonicalizeExistingWorkflows } from "../core/db/canonicalize_existing_workflows"
import { initDatabase, type InitializedDatabase } from "../core/db"
import {
  CollectionRepository,
  EnvironmentRepository,
  NodePresetRepository,
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
  AssertionAuthoringService,
  WorkflowAnalysisService,
  EnvironmentService,
  NodePresetService,
  RunService,
  SecretService,
  ProjectExportService,
  ImportService,
} from "../core/services"
import { LocalOwnerProvider } from "../core/auth"
import { LocalOnlySyncProvider, SwitchableSyncProvider } from "../core/sync"
import { RunScheduler, RunEventBroker, SafeHttp, DynamicFunctions } from "../core/runner"
import { WallClockProvider, CryptoRandomProvider } from "../core/runner/harness/providers"
import { McpHost } from "../core/mcp"
import { MCP_SERVER_INFO_TOOL, MCP_TOOLS, toolName } from "../core/mcp/tools"
import { MCP_PROMPTS } from "../core/mcp/prompts"
import { MCP_RESOURCES } from "../core/mcp/resources"
import type { McpStatus } from "@shared/types/McpStatus"
import type { MCPTool } from "@shared/types/MCPTool"
import type { MCPPrompt } from "@shared/types/MCPPrompt"
import type { MCPResource } from "@shared/types/MCPResource"
import type { McpTestResult } from "@shared/types/McpTestResult"
import { cloudDefaults, DesktopCloudSyncControl } from "./cloud/cloud-sync-control"
import { registerConflictUiHandlers } from "./cloud/conflict-ui-bridge"
import { CLOUD_STATUS_CHANGED_CHANNEL, UPDATE_STATUS_CHANGED_CHANNEL } from "../core/ipc/channels"
import { UpdateManager } from "./updater"
import { ipcLog, revealLogFile } from "./logging"
import type { UpdatePolicy, UpdateStatus } from "@shared/types/UpdateStatus"
import { isUpdatePolicy } from "@shared/types/UpdateStatus"

// The single request channel. The composition root (whenReady) constructs the
// services and calls registerAllHandlers onto it before attaching; the MCP host
// exposes the same router as a second transport. Every rejected dispatch is
// reported to the main.log file transport, so a refused workflow save leaves a
// line that names the domain, action, error code and message.
const ipcRouter = new IpcRouter({
  reportError: ({ domain, action, code, message, details }) => {
    ipcLog.error(`${domain}.${action} rejected (${code}): ${message}`, details ?? "")
  },
})

let database: InitializedDatabase | null = null
let scheduler: RunScheduler | null = null
let mcpHost: McpHost | null = null
let isQuitting = false

if (process.platform === "linux") {
  app.commandLine.appendSwitch("ozone-platform-hint", "auto")
}

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

let mainWindow: BrowserWindow | null = null

const APP_ORIGIN = "app://local"

function isAppOrigin(url: string): boolean {
  try {
    return new URL(url).origin === new URL(APP_ORIGIN).origin
  } catch {
    return false
  }
}

function frontendDistDir(): string {
  if (process.env["APIWEAVE_FRONTEND_DIST"]) {
    return process.env["APIWEAVE_FRONTEND_DIST"]
  }

  return app.isPackaged
    ? path.join(process.resourcesPath, "renderer")
    : path.resolve(app.getAppPath(), "dist/renderer")
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    backgroundColor: "#0b0b0f",
    // Packaged Windows/macOS builds get the taskbar/dock icon from the exe's
    // embedded resource (electron-builder's build.win/mac.icon), but this is
    // still needed for dev (`npm start`) and for Linux, where windows are
    // identified by this option rather than an embedded icon.
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
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

  // Never let the privileged app:// document navigate to attacker-controlled
  // content — that content would inherit the same preload/IPC bridge.
  win.webContents.on("will-navigate", (event, url) => {
    if (!isAppOrigin(url)) {
      event.preventDefault()
    }
  })

  // Renderer-created windows (e.g. target="_blank" links) never get the
  // privileged preload. http/https links open in the system browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url)
    }
    return { action: "deny" }
  })

  try {
    const rendererUrl = "app://local/"
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
    const nodePresets = new NodePresetRepository(database.kvStore)
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
    const secretService = new SecretService(secretStore, sync, permissions, scopeResolver, environments, keyfile.masterKek)
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
    // SSRF policy: loopback always on (local dev services); private-network
    // (RFC1918/ULA) targets are an opt-in persisted in app_settings and
    // flipped live on the shared instance below.
    const readAllowPrivateNetworks = (): boolean => {
      if (database === null) return false
      const row = database.kvStore.get<{ value: string }>(
        "SELECT value FROM app_settings WHERE key = 'http.allow_private_networks'",
      )
      return row?.value === "true"
    }
    const http = new SafeHttp({ allowLoopback: true, allowPrivateNetworks: readAllowPrivateNetworks() })
    const functions = new DynamicFunctions(clock, rng)
    // Single run-event broker: the scheduler publishes raw transitions; the
    // broker stamps seq/ts and fans out to the renderer (IPC) and MCP sessions.
    const runEvents = new RunEventBroker({ now: () => clock.isoNow() })
    runEvents.subscribe((event) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        emitRunProgress(mainWindow.webContents, event)
      }
    })
    scheduler = new RunScheduler({
      runs,
      workflows,
      environments,
      http,
      functions,
      clock,
      rng,
      resolveSecret: (name, chain) =>
        secretService.resolvePlaintext(name, chain).then((r) => ({ plaintext: r.plaintext, scopeType: r.scopeType })),
      emitProgress: (runId, event) => runEvents.publish(runId, event),
    })

    const interrupted = scheduler.reconcileOnStartup()
    if (interrupted > 0) {
      console.info(`[bootstrap] reconciled ${interrupted} stuck run(s) to interrupted`)
    }

    // Services over the scoped repos; RunService drives the scheduler so
    // runs.create actually executes and runs.cancel aborts a live run.
    const workflowService = new WorkflowService(workflows, sync, permissions, scopeResolver, collections, environments)
    const runService = new RunService(runs, sync, permissions, scopeResolver, scheduler)
    const deps: HandlerDeps = {
      workspaces: new WorkspaceService(workspaces, sync, scopeResolver, () => cloud.syncNewWorkspace()),
      collections: new CollectionService(collections, workflows, sync, permissions, scopeResolver),
      workflows: workflowService,
      workflowAnalysis: new WorkflowAnalysisService(workflowService, runService),
      assertionAuthoring: new AssertionAuthoringService(workflowService, runService),
      environments: new EnvironmentService(environments, sync, permissions, scopeResolver),
      nodePresets: new NodePresetService(nodePresets, permissions, scopeResolver),
      runs: runService,
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
      imports: new ImportService(workflows, environments, collections, sync, permissions, scopeResolver, http),
      httpSafety: {
        get allowPrivateNetworks(): boolean {
          return http.allowPrivateNetworks
        },
        setAllowPrivateNetworks: (enabled) => {
          http.setAllowPrivateNetworks(enabled)
          if (database === null) return
          database.kvStore.set(
            "INSERT INTO app_settings (key, value) VALUES ('http.allow_private_networks', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [enabled ? "true" : "false"],
          )
        },
      },
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
    const requireTrustedSender = <Args extends unknown[], R>(
      handler: (...args: Args) => R,
    ): ((event: Electron.IpcMainInvokeEvent, ...args: Args) => R | Promise<never>) => {
      return (event, ...args) => {
        if (!isTrustedSender(event)) {
          return Promise.reject(new Error("untrusted sender"))
        }
        return handler(...args)
      }
    }
    ipcMain.handle("mcp:getStatus", requireTrustedSender(() => mcpStatus()))
    ipcMain.handle(
      "mcp:enable",
      requireTrustedSender(async () => {
        if (mcpHost === null) {
          mcpHost = new McpHost({
            router: ipcRouter,
            tokenFilePath: mcpTokenPath,
            version: app.getVersion(),
            broker: runEvents,
          })
        }
        await mcpHost.start()
        writeMcpEnabled(true)
        return mcpStatus()
      }),
    )
    ipcMain.handle(
      "mcp:disable",
      requireTrustedSender(async () => {
        await mcpHost?.stop()
        writeMcpEnabled(false)
        return mcpStatus()
      }),
    )
    ipcMain.handle(
      "mcp:listTools",
      requireTrustedSender(
        (): readonly MCPTool[] => [
          { name: MCP_SERVER_INFO_TOOL.name, description: MCP_SERVER_INFO_TOOL.description },
          ...MCP_TOOLS.map((spec) => ({ name: toolName(spec), description: spec.description })),
        ],
      ),
    )
    ipcMain.handle(
      "mcp:listPrompts",
      requireTrustedSender(
        (): readonly MCPPrompt[] =>
          MCP_PROMPTS.map((spec) => ({ name: spec.name, description: spec.description })),
      ),
    )
    ipcMain.handle(
      "mcp:listResources",
      requireTrustedSender((): readonly MCPResource[] => MCP_RESOURCES.map((spec) => ({ ...spec }))),
    )
    // Probe the endpoint from the trusted main process: a renderer fetch sends an
    // app-scheme Origin that the host's DNS-rebinding guard rejects, so it can
    // only ever report failure. Main sends no Origin and is accepted.
    ipcMain.handle(
      "mcp:testConnection",
      requireTrustedSender(async (): Promise<McpTestResult> => {
        const config = mcpHost?.getConfig()
        if (!mcpHost?.isRunning() || config === null || config === undefined) {
          return { ok: false, status: null }
        }
        const authHeaders = { Authorization: `Bearer ${config.token}` }
        try {
          const response = await fetch(config.url, {
            method: "POST",
            headers: {
              ...authHeaders,
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: {
                protocolVersion: "2025-06-18",
                capabilities: {},
                clientInfo: { name: "apiweave-ui", version: app.getVersion() },
              },
            }),
          })
          // initialize opens a retained session; DELETE it so a probe never leaks.
          const session = response.headers.get("mcp-session-id")
          if (session !== null) {
            await fetch(config.url, {
              method: "DELETE",
              headers: { ...authHeaders, "mcp-session-id": session },
            }).catch(() => undefined)
          }
          return { ok: response.ok, status: response.status }
        } catch {
          return { ok: false, status: null }
        }
      }),
    )

    // Restore the user's persisted MCP choice on launch.
    if (readMcpEnabled()) {
      mcpHost = new McpHost({
        router: ipcRouter,
        tokenFilePath: mcpTokenPath,
        version: app.getVersion(),
        broker: runEvents,
      })
      void mcpHost
        .start()
        .then(() => console.info("[mcp] auto-started local MCP server from persisted setting"))
        .catch((error: unknown) => {
          console.error(`[mcp] auto-start failed: ${error instanceof Error ? error.message : String(error)}`)
          mcpHost = null
        })
    }

    // Update checks. One manager instance owns both the auto-installing path
    // (Windows NSIS / Linux AppImage, via electron-updater) and the
    // notice-only fallback (macOS, deb/rpm/pacman) — see electron/updater.ts.
    // A silent check runs shortly after launch so "new version available"
    // surfaces without the user asking; the Settings > Updates panel also
    // lets them check on demand.
    // How much the updater may do unattended is the user's call, persisted in
    // app_settings alongside mcp.enabled. The default is "notify" rather than
    // "automatic": the Windows build is unsigned, so electron-updater has no
    // Authenticode publisher to check the downloaded installer against, and the
    // user approving a specific version is the only verification there is.
    const readUpdatePolicy = (): UpdatePolicy | null => {
      if (database === null) return null
      const row = database.kvStore.get<{ value: string }>(
        "SELECT value FROM app_settings WHERE key = 'updates.policy'",
      )
      return isUpdatePolicy(row?.value) ? row.value : null
    }
    const writeUpdatePolicy = (policy: UpdatePolicy): void => {
      if (database === null) return
      database.kvStore.set(
        "INSERT INTO app_settings (key, value) VALUES ('updates.policy', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [policy],
      )
    }
    const updates = new UpdateManager({
      onChange: (status) => {
        if (mainWindow !== null && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(UPDATE_STATUS_CHANGED_CHANNEL, status)
        }
      },
      readPolicy: readUpdatePolicy,
      writePolicy: writeUpdatePolicy,
    })
    // Deliberately off the `core/ipc/handlers/` registry, matching the mcp:*
    // handlers above: the registry is also the MCP bridge's handler list
    // (AGENTS.md — "MCP bridge uses the same handlers"), and a local agent
    // being able to trigger a restart-and-install is not something to expose
    // there. Direct ipcMain.handle keeps it reachable only from the renderer.
    ipcMain.handle("updates:getStatus", requireTrustedSender((): UpdateStatus => updates.getStatus()))
    ipcMain.handle("updates:check", requireTrustedSender((): Promise<UpdateStatus> => updates.check()))
    ipcMain.handle(
      "updates:download",
      requireTrustedSender((): Promise<UpdateStatus> => updates.download()),
    )
    ipcMain.handle(
      "updates:setPolicy",
      requireTrustedSender(
        (policy: UpdatePolicy): Promise<UpdateStatus> =>
          isUpdatePolicy(policy)
            ? updates.setPolicy(policy)
            : Promise.reject(new Error(`unknown update policy: ${String(policy)}`)),
      ),
    )
    ipcMain.handle(
      "updates:restartAndInstall",
      requireTrustedSender((): void => updates.restartAndInstall()),
    )
    ipcMain.handle(
      "updates:openReleasePage",
      requireTrustedSender((): void => updates.openReleasePage()),
    )
    ipcMain.handle(
      "updates:openLogFile",
      requireTrustedSender((): void => revealLogFile()),
    )
    // Owns its own timers: one check just after launch, then one every few
    // hours so a window left open for days still notices a release.
    //
    // Deliberately never paired with updates.dispose() here. The manager lives
    // as long as the process, and calling it on a quit event would remove the
    // "error" listener while electron-updater's install-on-quit hook is still
    // able to emit — an EventEmitter with no error listener throws. Teardown
    // exists for callers that build more than one manager; see its docblock.
    updates.start()

    protocol.handle("app", async (request) => {
      let pathname: string
      try {
        pathname = decodeURIComponent(new URL(request.url).pathname)
      } catch {
        // Malformed percent-encoding — reject rather than serve anything.
        return new Response(null, { status: 400 })
      }

      if (pathname === "/" || pathname === "" || !path.extname(pathname)) {
        pathname = "/index.html"
      }

      // Confine the served file to the renderer bundle. Encoded separators or
      // dot segments could otherwise escape frontendDistDir and read arbitrary
      // files accessible to the Electron process.
      const baseDir = path.resolve(frontendDistDir())
      const filePath = path.resolve(baseDir, `.${pathname}`)
      if (filePath !== baseDir && !filePath.startsWith(baseDir + path.sep)) {
        return new Response(null, { status: 404 })
      }

      const response = await net.fetch(pathToFileURL(filePath).toString())
      // Local files behind a privileged scheme get heuristically cached by
      // Electron, pinning index.html to stale asset hashes after a rebuild
      // ("restarted dev, UI didn't change"). Reading from disk is cheap, so
      // never cache.
      const headers = new Headers(response.headers)
      headers.set("Cache-Control", "no-store")
      // Restrict the renderer document to same-origin scripts/workers only.
      // Monaco is now bundled locally (see src/lib/monaco.ts) and the editor
      // assets are served from app://local, so no CDN script source is needed.
      // Other resource types (fonts, images, styles) are left unrestricted to
      // keep web-font loading working; only script/worker execution is pinned.
      // 'wasm-unsafe-eval' allows WebAssembly.instantiate (libsodium ships a
      // wasm build) without granting full eval.
      if (pathname === "/index.html") {
        headers.set(
          "Content-Security-Policy",
          "script-src 'self' app: 'wasm-unsafe-eval'; worker-src 'self' app: blob:",
        )
      }
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
