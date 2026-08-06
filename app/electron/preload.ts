import { contextBridge, ipcRenderer } from "electron"
import type { ContractResult } from "@shared/contract/errors"
import type { RunProgressEvent } from "@shared/types/RunProgressEvent"
import type { McpStatus } from "@shared/types/McpStatus"
import type { MCPTool } from "@shared/types/MCPTool"
import type { MCPPrompt } from "@shared/types/MCPPrompt"
import type { MCPResource } from "@shared/types/MCPResource"
import type { McpTestResult } from "@shared/types/McpTestResult"
import type { UpdatePolicy, UpdateStatus } from "@shared/types/UpdateStatus"
import {
  CLOUD_STATUS_CHANGED_CHANNEL,
  INVOKE_CHANNEL,
  runProgressChannel,
  UPDATE_STATUS_CHANGED_CHANNEL,
} from "../core/ipc/channels"

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
  onRunProgress: (runId, callback) => {
    const channel = runProgressChannel(runId)
    const handler = (_event: Electron.IpcRendererEvent, value: RunProgressEvent): void => {
      callback(value)
    }
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
  onCloudStatusChanged: (callback) => {
    const handler = (): void => callback()
    ipcRenderer.on(CLOUD_STATUS_CHANGED_CHANNEL, handler)
    return () => ipcRenderer.removeListener(CLOUD_STATUS_CHANGED_CHANNEL, handler)
  },
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
  getStatus: () => ipcRenderer.invoke("mcp:getStatus") as Promise<McpStatus>,
  enable: () => ipcRenderer.invoke("mcp:enable") as Promise<McpStatus>,
  disable: () => ipcRenderer.invoke("mcp:disable") as Promise<McpStatus>,
  listTools: () => ipcRenderer.invoke("mcp:listTools") as Promise<readonly MCPTool[]>,
  listPrompts: () => ipcRenderer.invoke("mcp:listPrompts") as Promise<readonly MCPPrompt[]>,
  listResources: () => ipcRenderer.invoke("mcp:listResources") as Promise<readonly MCPResource[]>,
  testConnection: () => ipcRenderer.invoke("mcp:testConnection") as Promise<McpTestResult>,
}

contextBridge.exposeInMainWorld("__APIWEAVE_MCP__", mcpBridge)

/** Update checks for the Settings > Updates panel. */
type UpdatesBridge = {
  readonly getStatus: () => Promise<UpdateStatus>
  readonly check: () => Promise<UpdateStatus>
  readonly download: () => Promise<UpdateStatus>
  readonly setPolicy: (policy: UpdatePolicy) => Promise<UpdateStatus>
  readonly restartAndInstall: () => Promise<void>
  readonly openReleasePage: () => Promise<void>
  readonly openLogFile: () => Promise<void>
  readonly onStatusChanged: (callback: (status: UpdateStatus) => void) => () => void
}

const updatesBridge: UpdatesBridge = {
  getStatus: () => ipcRenderer.invoke("updates:getStatus") as Promise<UpdateStatus>,
  check: () => ipcRenderer.invoke("updates:check") as Promise<UpdateStatus>,
  download: () => ipcRenderer.invoke("updates:download") as Promise<UpdateStatus>,
  setPolicy: (policy) => ipcRenderer.invoke("updates:setPolicy", policy) as Promise<UpdateStatus>,
  restartAndInstall: () => ipcRenderer.invoke("updates:restartAndInstall") as Promise<void>,
  openReleasePage: () => ipcRenderer.invoke("updates:openReleasePage") as Promise<void>,
  openLogFile: () => ipcRenderer.invoke("updates:openLogFile") as Promise<void>,
  onStatusChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: UpdateStatus): void => callback(value)
    ipcRenderer.on(UPDATE_STATUS_CHANGED_CHANNEL, handler)
    return () => ipcRenderer.removeListener(UPDATE_STATUS_CHANGED_CHANNEL, handler)
  },
}

contextBridge.exposeInMainWorld("__APIWEAVE_UPDATES__", updatesBridge)
