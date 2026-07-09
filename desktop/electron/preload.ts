import { contextBridge, ipcRenderer } from "electron"
import type { ContractResult } from "../../shared/contract/errors"
import type { RunProgressEvent } from "../../shared/types/RunProgressEvent"
import type { McpStatus } from "../../shared/types/McpStatus"
import type { MCPTool } from "../../shared/types/MCPTool"
import { INVOKE_CHANNEL, runProgressChannel } from "../core/ipc/channels"

/**
 * The untyped data-channel primitive. The renderer (Task 17) wraps `invoke` with
 * `createApiweaveClient` to get `window.apiweave.domain.action(payload)` sugar —
 * the proxy is built renderer-side because `contextBridge` cannot clone Proxies.
 */
type IpcBridge = {
  readonly invoke: (domain: string, action: string, payload: unknown) => Promise<ContractResult<unknown>>
  readonly onRunProgress: (runId: string, callback: (event: RunProgressEvent) => void) => () => void
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
}

const mcpBridge: McpBridge = {
  getStatus: () => ipcRenderer.invoke("mcp:getStatus") as Promise<McpStatus>,
  enable: () => ipcRenderer.invoke("mcp:enable") as Promise<McpStatus>,
  disable: () => ipcRenderer.invoke("mcp:disable") as Promise<McpStatus>,
  listTools: () => ipcRenderer.invoke("mcp:listTools") as Promise<readonly MCPTool[]>,
}

contextBridge.exposeInMainWorld("__APIWEAVE_MCP__", mcpBridge)
