import { contextBridge, ipcRenderer } from "electron"
import type { ContractResult } from "@shared/contract/errors"
import type { RunProgressEvent } from "@shared/types/RunProgressEvent"
import type { McpStatus } from "@shared/types/McpStatus"
import type { MCPTool } from "@shared/types/MCPTool"
import type { MCPPrompt } from "@shared/types/MCPPrompt"
import type { MCPResource } from "@shared/types/MCPResource"
import type { McpTestResult } from "@shared/types/McpTestResult"
import type { UpdatesBridge, UpdateStatus } from "@shared/types/UpdateStatus"
import {
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
