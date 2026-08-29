// fallow-ignore-file code-duplication -- the agents registry table is the typed routing surface of this process: every row names a channel and forwards to its service method, so any channel gained clones every other by construction (same reasoning as `src/utils/apiweaveClient.ts`); fallow 2.104 has no range form, so file-level is the only single-justification form available
import { app, BrowserWindow, ipcMain, net, protocol, shell } from "electron"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { IpcRouter, attachIpcRouter } from "../core/ipc/index"
import { emitRunProgress, isTrustedSender } from "../core/ipc/register"
import { registerAllHandlers, type HandlerDeps } from "../core/ipc/handlers"
import { canonicalizeExistingWorkflows } from "../core/db/canonicalize_existing_workflows"
import { initDatabase, type InitializedDatabase } from "../core/db"
import {
  AgentRepository,
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
  AgentService,
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
import { AgentEventBroker } from "../core/agents/agent_event_broker"
import { hydratePathFromLoginShell } from "../core/agents/login_path"
import { AgentProcessManager } from "./agent_process_manager"
import type { AgentDefinition } from "@shared/types/AgentDefinition"
import type { AgentScope } from "@shared/types/AgentScope"
import type { AgentEmbeddedLaunchRequest, AgentLaunchRequest } from "@shared/types/AgentsBridge"
import type { McpStatus } from "@shared/types/McpStatus"
import type { MCPTool } from "@shared/types/MCPTool"
import type { MCPPrompt } from "@shared/types/MCPPrompt"
import type { MCPResource } from "@shared/types/MCPResource"
import type { McpTestResult } from "@shared/types/McpTestResult"
import type { WorkflowChangedEvent } from "@shared/types/WorkflowChangedEvent"
import { cloudDefaults, DesktopCloudSyncControl } from "./cloud/cloud-sync-control"
import { registerConflictUiHandlers } from "./cloud/conflict-ui-bridge"
import {
  AGENT_CHANNELS,
  AGENT_OUTPUT_PORT_CHANNEL,
  AGENT_SESSION_CHANGED_CHANNEL,
  CLOUD_STATUS_CHANGED_CHANNEL,
  UPDATE_STATUS_CHANGED_CHANNEL,
  WORKFLOW_CHANGED_CHANNEL,
} from "../core/ipc/channels"
import { UpdateManager } from "./updater"
import { getLogger } from "../core/logging/logger"
import { initLogging, ipcLog, revealLogFile } from "./logging"
import type { UpdatePolicy, UpdateStatus } from "@shared/types/UpdateStatus"
import { isUpdatePolicy } from "@shared/types/UpdateStatus"

const bootstrapLog = getLogger("bootstrap")
const rendererLog = getLogger("renderer")
const mcpLog = getLogger("mcp")
const agentsLog = getLogger("agents")

// Bind the logging system before anything else in this file runs: the
// single-instance and canonicalisation lines below are the first records of a
// session, and the ones a crash report most needs to see.
initLogging()

// Before anything resolves an executable: a GUI-launched app inherits the
// desktop session's PATH, not the user's. See hydratePathFromLoginShell.
const hydratedPath = hydratePathFromLoginShell()
if (hydratedPath !== null) {
  bootstrapLog.info(`PATH hydrated from ${process.env["SHELL"]}`)
}

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
// Module scope for the same reason `mcpHost` is: `before-quit` has to reach it,
// and it is built inside the composition root.
let agentProcesses: AgentProcessManager | null = null
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
    // The floor the canvas toolbar was sized against: below this the sidebar,
    // the agent panel and a usable canvas stop fitting side by side. Still
    // narrow enough to snap to half of a 1080p screen.
    minWidth: 1024,
    minHeight: 700,
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
    rendererLog.error(`did-fail-load ${code} ${description} ${url}`)
  })
  win.webContents.on("render-process-gone", (_event, details) => {
    rendererLog.error("render-process-gone", details)
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
    rendererLog.info(`loaded ${rendererUrl}`)
  } catch (error) {
    if (error instanceof Error) {
      rendererLog.error(`load failed: ${error.message}`)
      return
    }

    throw error
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
bootstrapLog.info(`single-instance-lock=${hasSingleInstanceLock}`)

if (!hasSingleInstanceLock) {
  bootstrapLog.info("second instance rejected; quitting")
  app.quit()
} else {
  app.on("second-instance", () => {
    bootstrapLog.info("second-instance event; focusing existing window")

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
      bootstrapLog.info(`canonicalised ${canonicalised} workflow graph(s) to KeyValuePair[] form`)
    }

    // Repositories — the only DB touchpoint.
    const workspaces = new WorkspaceRepository(database.kvStore)
    // One broadcast for every workflow write, wherever it came from: the
    // repository (renderer saves, MCP tools, imports) and the cloud pull
    // (raw SQL in CloudSyncRepository) both land here. A pulled tombstone
    // leaves no row to read, so it is announced as a delete directly.
    const sendWorkflowChanged = (event: WorkflowChangedEvent): void => {
      if (mainWindow !== null && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(WORKFLOW_CHANGED_CHANNEL, event)
      }
    }
    // Raw SQL writers (cloud pull, conflict resolution) only know which row
    // changed; resolve it here — or report its absence as a delete — so the
    // broadcast always carries an authoritative snapshot.
    const onRawWorkflowWrite = (
      workspaceId: string,
      workflowId: string,
      deleted: boolean,
    ): void => {
      const workflow = deleted ? undefined : workflows.getById(workflowId)
      if (workflow !== undefined) {
        sendWorkflowChanged({ kind: "upsert", workflow })
      } else {
        sendWorkflowChanged({ kind: "delete", workspaceId, workflowId })
      }
    }
    const workflows = new WorkflowRepository(database.kvStore, sendWorkflowChanged)
    const runs = new RunRepository(database.kvStore)
    const environments = new EnvironmentRepository(database.kvStore)
    const collections = new CollectionRepository(database.kvStore)
    const nodePresets = new NodePresetRepository(database.kvStore)
    const agents = new AgentRepository(database.kvStore)
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
      onWorkflowChanged: onRawWorkflowWrite,
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
      bootstrapLog.info(`reconciled ${interrupted} stuck run(s) to interrupted`)
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
      environments: new EnvironmentService(environments, sync, permissions, scopeResolver, workflows, secretStore),
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
      onWorkflowChanged: onRawWorkflowWrite,
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
        .then(() => mcpLog.info("auto-started local MCP server from persisted setting"))
        .catch((error: unknown) => {
          mcpLog.error(`auto-start failed: ${error instanceof Error ? error.message : String(error)}`)
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

    // Coding agents. Off the router for the same reason as mcp:* and updates:*
    // above, and more sharply: the router is the MCP bridge's handler list, so
    // registering "spawn a process with this working directory" there would put
    // it one whitelist entry from being callable by a local agent over loopback
    // HTTP. A fourth privileged preload world makes that structural instead of
    // remembered.
    //
    // The PTY host is forked lazily, on the first embedded launch, and its
    // events land here rather than in the manager: what a session row should
    // say about a dead process is policy, and the manager only knows processes.
    // Order matters — the broker dedupes terminal transitions first, then the
    // one subscriber persists and pushes, so the renderer never sees an event
    // whose row has not been written yet.
    const agentEvents = new AgentEventBroker({ now: () => clock.isoNow() })
    const agentPtyHost = new AgentProcessManager({
      hostEntryPath: path.join(__dirname, "pty-host.cjs"),
      onEvent: (event) => agentEvents.publish(event),
    })
    agentProcesses = agentPtyHost
    const agentService = new AgentService(agents, workflows, collections, permissions, scopeResolver, {
      // The picker runs here, in main, so the path the renderer eventually sees
      // came from the OS rather than from the renderer.
      pickDirectory: async ({ title, defaultPath }) => {
        const { dialog } = await import("electron")
        const result = await dialog.showOpenDialog({
          title,
          properties: ["openDirectory", "createDirectory"],
          ...(defaultPath === undefined ? {} : { defaultPath }),
        })
        return result.canceled ? null : (result.filePaths[0] ?? null)
      },
      getMcpConfig: () => mcpHost?.getConfig() ?? null,
      agentFilesDir: path.join(app.getPath("userData"), "agent-files"),
      pty: agentPtyHost,
    })
    agentEvents.subscribe((event) => {
      agentService.recordProcessEvent(event)
      if (mainWindow !== null && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(AGENT_SESSION_CHANGED_CHANNEL, event)
      }
    })
    // Anything still marked live is a leftover from a crash — the process it
    // named did not outlive the app that owned it.
    const orphaned = agents.markOrphanedSessionsFailed()
    if (orphaned > 0) {
      agentsLog.info(`marked ${orphaned} orphaned agent session(s) failed`)
    }
    // The same crash leaves scratch files behind, and those are not inert: an
    // agent's MCP config carries a live bearer token for this app. The launch
    // path sweeps too, but only on the next launch — a user who never starts
    // another agent would keep the last run's token on disk indefinitely.
    const swept = agentService.sweepScratchFiles()
    if (swept > 0) {
      agentsLog.info(`reclaimed ${swept} stale agent scratch file(s)`)
    }
    /**
     * Register one agents channel behind the trusted-sender guard, exactly like
     * the other privileged domains above. Every registration is the same two
     * steps — name the channel, wrap the service call — so the shape lives here
     * once, and the channel→method mapping itself is the table below: adding a
     * channel is a row, not a registration statement.
     */
    const onAgents = <Args extends unknown[], R>(channel: string, handler: (...args: Args) => R): void => {
      ipcMain.handle(channel, requireTrustedSender(handler))
    }
    const agentHandlers: ReadonlyArray<readonly [channel: string, handler: (...args: never[]) => unknown]> = [
      [AGENT_CHANNELS.listRoster, (workspaceId: string) => agentService.listRoster(workspaceId)],
      [AGENT_CHANNELS.refreshAvailability, (workspaceId: string) => agentService.refreshAvailability(workspaceId)],
      [AGENT_CHANNELS.saveCustomAgent, (workspaceId: string, definition: AgentDefinition) => agentService.saveCustomAgent(workspaceId, definition)],
      [AGENT_CHANNELS.deleteCustomAgent, (workspaceId: string, agentKey: string) => agentService.deleteCustomAgent(workspaceId, agentKey)],
      [AGENT_CHANNELS.getDefaultAgentKey, (workspaceId: string) => agentService.getDefaultAgentKey(workspaceId)],
      [AGENT_CHANNELS.setDefaultAgentKey, (workspaceId: string, agentKey: string) => agentService.setDefaultAgentKey(workspaceId, agentKey)],
      [AGENT_CHANNELS.resolveLocalPath, (workspaceId: string, scope: AgentScope) => agentService.resolveLocalPath(workspaceId, scope)],
      [AGENT_CHANNELS.chooseLocalPath, (workspaceId: string, scope: AgentScope) => agentService.chooseLocalPath(workspaceId, scope)],
      [AGENT_CHANNELS.clearLocalPath, (workspaceId: string, scope: AgentScope) => agentService.clearLocalPath(workspaceId, scope)],
      [AGENT_CHANNELS.listSessions, (workspaceId: string) => agentService.listSessions(workspaceId)],
      [AGENT_CHANNELS.launchExternal, (request: AgentLaunchRequest) => agentService.launchExternal(request)],
      [AGENT_CHANNELS.launchEmbedded, (request: AgentEmbeddedLaunchRequest) => agentService.launchEmbedded(request)],
      [AGENT_CHANNELS.resumeSession, (sessionId: string, cols: number, rows: number) => agentService.resumeSession(sessionId, cols, rows)],
      [AGENT_CHANNELS.write, (sessionId: string, data: string) => agentService.writeToSession(sessionId, data)],
      [AGENT_CHANNELS.resize, (sessionId: string, cols: number, rows: number) => agentService.resizeSession(sessionId, cols, rows)],
      [AGENT_CHANNELS.setPaused, (sessionId: string, paused: boolean) => agentService.setSessionPaused(sessionId, paused)],
      [AGENT_CHANNELS.killSession, (sessionId: string) => agentService.killSession(sessionId)],
      [AGENT_CHANNELS.deleteSession, (sessionId: string) => agentService.deleteSession(sessionId)],
    ]
    for (const [channel, handler] of agentHandlers) {
      onAgents(channel, handler)
    }
    // The one agents handler written out rather than wrapped: it has to reply
    // with a `MessagePort`, which cannot be returned through `invoke` at all —
    // only sent in a transfer list. So it needs the event, and `requireTrustedSender`
    // exists precisely to hide the event from handlers that do not.
    ipcMain.handle(AGENT_CHANNELS.attach, async (event, sessionId: string): Promise<boolean> => {
      if (!isTrustedSender(event)) {
        return Promise.reject(new Error("untrusted sender"))
      }
      const { attachable } = await agentService.authorizeSessionRead(sessionId)
      if (!attachable) {
        return false
      }
      const port = agentPtyHost.attach(sessionId)
      if (port === null) {
        return false
      }
      // Straight to the frame that asked, not to the window: another frame is
      // another document, and this port is one document's terminal.
      const frame = event.senderFrame
      if (frame === null || frame === undefined) {
        // The caller navigated away while we were authorizing. Nothing to
        // deliver to, and an unclosed port would keep the host writing into it.
        port.close()
        return false
      }
      try {
        frame.postMessage(AGENT_OUTPUT_PORT_CHANNEL, { sessionId }, [port])
      } catch {
        // `senderFrame` is non-null for a frame object that has already been
        // detached — the document navigated or its window closed while we were
        // awaiting authorization — and posting into one throws. The null check
        // above does not cover it, and an unclosed port would leave the host
        // writing chunks into a channel whose other end nobody holds.
        port.close()
        return false
      }
      return true
    })
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

  // Two things can now need time before the database may close, so they are
  // collected rather than handled with two copies of the deferred-quit dance.
  const shutdowns: Promise<unknown>[] = []

  if (agentProcesses !== null) {
    // Agent processes are the user's own CLIs, running under a PTY this app
    // owns. Quitting without killing them leaves processes attached to a
    // terminal that no longer exists — so this is waited on when there is
    // anything to wait for, and merely started when there is not.
    const hasLiveSessions = agentProcesses.liveSessionIds().length > 0
    const disposal = agentProcesses.dispose()
    agentProcesses = null
    if (hasLiveSessions) {
      shutdowns.push(disposal)
    } else {
      void disposal
    }
  }

  if (scheduler && scheduler.getActiveCount() > 0) {
    shutdowns.push(scheduler.shutdown(2000))
  }

  if (shutdowns.length > 0) {
    event.preventDefault()
    void Promise.allSettled(shutdowns).finally(() => {
      database?.close()
      database = null
      app.quit()
    })
    return
  }

  database?.close()
  database = null
})
