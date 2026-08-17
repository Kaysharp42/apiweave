// fallow-ignore-file code-duplication -- the bridge objects at the bottom are the typed surface of the registry they front: every property names a channel and forwards to `invoke`, so any method gained clones every other by construction (same reasoning as `src/utils/apiweaveClient.ts`, and the same file-level form); fallow 2.104 has no range form
import { contextBridge, ipcRenderer } from "electron"
import type { ContractResult } from "@shared/contract/errors"
import type { RunProgressEvent } from "@shared/types/RunProgressEvent"
import type { McpStatus } from "@shared/types/McpStatus"
import type { MCPTool } from "@shared/types/MCPTool"
import type { MCPPrompt } from "@shared/types/MCPPrompt"
import type { MCPResource } from "@shared/types/MCPResource"
import type { McpTestResult } from "@shared/types/McpTestResult"
import type { AgentsBridge } from "@shared/types/AgentsBridge"
import type { AgentSessionEvent } from "@shared/types/AgentSessionEvent"
import { AGENT_OUTPUT_PORT_MESSAGE_KEY } from "@shared/types/AgentOutputEvent"
import type { UpdatesBridge, UpdateStatus } from "@shared/types/UpdateStatus"
import {
  AGENT_CHANNELS,
  AGENT_OUTPUT_PORT_CHANNEL,
  AGENT_SESSION_CHANGED_CHANNEL,
  CLOUD_STATUS_CHANGED_CHANNEL,
  INVOKE_CHANNEL,
  runProgressChannel,
  UPDATE_STATUS_CHANGED_CHANNEL,
} from "../core/ipc/channels"

/**
 * Registers an ipcRenderer listener and returns its unsubscribe. Every event
 * bridge below needs the same three steps — wrap the handler, register it,
 * hand back a remover that closes over *that* handler — and a remover built
 * against a different function silently leaks a listener per renderer reload.
 * One implementation means that can only be right or wrong once.
 */
function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, value: T): void => callback(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

/**
 * A no-argument `ipcRenderer.invoke` for one channel, typed. Every request-style
 * bridge method below is this same line, and writing it out per method means the
 * channel name and the return type are asserted in n places instead of one.
 */
function call<T>(channel: string): () => Promise<T> {
  return () => ipcRenderer.invoke(channel) as Promise<T>
}

/**
 * The argument-taking counterpart of {@link call}: a bridge-method factory that
 * forwards one channel through `ipcRenderer.invoke`, with the method's own
 * parameter and return types supplied by the bridge interface it is assigned
 * into. Every request-style method of the agents bridge is this same line, and
 * writing it out per method means the channel name and the types are asserted
 * in n places instead of one.
 */
function invokeBridge<Args extends readonly unknown[], Result>(channel: string): (...args: Args) => Promise<Result> {
  return (...args: Args) => ipcRenderer.invoke(channel, ...args) as Promise<Result>
}

/**
 * The untyped data-channel primitive. The renderer (Task 17) wraps `invoke` with
 * `createApiweaveClient` to get `window.apiweave.domain.action(payload)` sugar —
 * the proxy is built renderer-side because `contextBridge` cannot clone Proxies.
 */
type IpcBridge = {
  readonly invoke: (domain: string, action: string, payload: unknown) => Promise<ContractResult<unknown>>
  readonly onRunProgress: (runId: string, callback: (event: RunProgressEvent) => void) => () => void
  readonly onCloudStatusChanged: (callback: () => void) => () => void
}

const ipcBridge: IpcBridge = {
  invoke: (domain, action, payload) =>
    ipcRenderer.invoke(INVOKE_CHANNEL, { domain, action, payload }) as Promise<ContractResult<unknown>>,
  onRunProgress: (runId, callback) =>
    subscribe<RunProgressEvent>(runProgressChannel(runId), callback),
  onCloudStatusChanged: (callback) =>
    subscribe<void>(CLOUD_STATUS_CHANGED_CHANNEL, () => callback()),
}

contextBridge.exposeInMainWorld("__APIWEAVE_IPC__", ipcBridge)

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

/** Opt-in MCP server controls for the Setup-MCP dialog. */
type McpBridge = {
  readonly getStatus: () => Promise<McpStatus>
  readonly enable: () => Promise<McpStatus>
  readonly disable: () => Promise<McpStatus>
  readonly listTools: () => Promise<readonly MCPTool[]>
  readonly listPrompts: () => Promise<readonly MCPPrompt[]>
  readonly listResources: () => Promise<readonly MCPResource[]>
  readonly testConnection: () => Promise<McpTestResult>
}

const mcpBridge: McpBridge = {
  getStatus: call<McpStatus>("mcp:getStatus"),
  enable: call<McpStatus>("mcp:enable"),
  disable: call<McpStatus>("mcp:disable"),
  listTools: call<readonly MCPTool[]>("mcp:listTools"),
  listPrompts: call<readonly MCPPrompt[]>("mcp:listPrompts"),
  listResources: call<readonly MCPResource[]>("mcp:listResources"),
  testConnection: call<McpTestResult>("mcp:testConnection"),
}

contextBridge.exposeInMainWorld("__APIWEAVE_MCP__", mcpBridge)

// Update checks for the Settings > Updates panel. The shape lives in
// @shared/types/UpdateStatus because the renderer's client consumes the same
// contract — see UpdatesBridge there.
const updatesBridge: UpdatesBridge = {
  getStatus: call<UpdateStatus>("updates:getStatus"),
  check: call<UpdateStatus>("updates:check"),
  download: call<UpdateStatus>("updates:download"),
  setPolicy: (policy) => ipcRenderer.invoke("updates:setPolicy", policy) as Promise<UpdateStatus>,
  restartAndInstall: call<void>("updates:restartAndInstall"),
  openReleasePage: call<void>("updates:openReleasePage"),
  openLogFile: call<void>("updates:openLogFile"),
  onStatusChanged: (callback) => subscribe<UpdateStatus>(UPDATE_STATUS_CHANGED_CHANNEL, callback),
}

contextBridge.exposeInMainWorld("__APIWEAVE_UPDATES__", updatesBridge)

/**
 * Coding-agent roster, project paths and launching.
 *
 * A fourth privileged world rather than a domain on `__APIWEAVE_IPC__`, because
 * that channel routes through `IpcRouter` — which the MCP bridge also serves as
 * a loopback-HTTP transport. Registering process spawning there would put it one
 * whitelist entry away from being callable by a local agent. Same reasoning, and
 * the same shape, as the `mcp:*` and `updates:*` handlers above.
 */
const agentsBridge: AgentsBridge = {
  listRoster: invokeBridge(AGENT_CHANNELS.listRoster),
  refreshAvailability: invokeBridge(AGENT_CHANNELS.refreshAvailability),
  saveCustomAgent: invokeBridge(AGENT_CHANNELS.saveCustomAgent),
  deleteCustomAgent: invokeBridge(AGENT_CHANNELS.deleteCustomAgent),
  getDefaultAgentKey: invokeBridge(AGENT_CHANNELS.getDefaultAgentKey),
  setDefaultAgentKey: invokeBridge(AGENT_CHANNELS.setDefaultAgentKey),
  resolveLocalPath: invokeBridge(AGENT_CHANNELS.resolveLocalPath),
  chooseLocalPath: invokeBridge(AGENT_CHANNELS.chooseLocalPath),
  clearLocalPath: invokeBridge(AGENT_CHANNELS.clearLocalPath),
  listSessions: invokeBridge(AGENT_CHANNELS.listSessions),
  launchExternal: invokeBridge(AGENT_CHANNELS.launchExternal),
  launchEmbedded: invokeBridge(AGENT_CHANNELS.launchEmbedded),
  resumeSession: invokeBridge(AGENT_CHANNELS.resumeSession),
  write: invokeBridge(AGENT_CHANNELS.write),
  resize: invokeBridge(AGENT_CHANNELS.resize),
  setPaused: invokeBridge(AGENT_CHANNELS.setPaused),
  killSession: invokeBridge(AGENT_CHANNELS.killSession),
  deleteSession: invokeBridge(AGENT_CHANNELS.deleteSession),
  attach: invokeBridge(AGENT_CHANNELS.attach),
  onSessionChanged: (callback) => subscribe<AgentSessionEvent>(AGENT_SESSION_CHANGED_CHANNEL, callback),
}

contextBridge.exposeInMainWorld("__APIWEAVE_AGENTS__", agentsBridge)

/**
 * The one thing that cannot travel over `contextBridge`: a session's output port.
 *
 * `contextBridge` clones what it passes, and a `MessagePort` is transferable but
 * not cloneable — it has to move, not copy. Preload and the page do share one
 * frame, though, so re-posting it with `window.postMessage` and the port in the
 * transfer list carries it across the isolation boundary. This is Electron's own
 * documented pattern for reaching the main world with a port.
 *
 * Registered once at load rather than per subscriber. A port is delivered to
 * exactly one context, so a second listener here would be a second claimant on
 * something that can only be claimed once.
 *
 * It exposes nothing the page did not already have: any script that could listen
 * for this message is running in the page and can call
 * `window.__APIWEAVE_AGENTS__` directly, which is strictly more capability.
 */
ipcRenderer.on(AGENT_OUTPUT_PORT_CHANNEL, (event, payload: { readonly sessionId: string }) => {
  const port = event.ports[0]
  if (port === undefined) return
  window.postMessage({ [AGENT_OUTPUT_PORT_MESSAGE_KEY]: payload.sessionId }, "*", [port])
})
