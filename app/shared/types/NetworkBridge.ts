import type { NetworkSettingsState } from "./NetworkSettingsState"
import type { NetworkSettingsUpdate } from "./NetworkSettingsUpdate"

/**
 * The `window.__APIWEAVE_NETWORK__` contract: Settings > Network. Off the IPC
 * router, so no local agent can reach it over MCP: it decides where every
 * request goes (the proxy), which servers are trusted (CAs), and makes main
 * read files from disk.
 */
export interface NetworkBridge {
  readonly get: () => Promise<NetworkSettingsState>
  /** Validates (every file is read and checked) before anything is stored, then applies. */
  readonly save: (update: NetworkSettingsUpdate) => Promise<NetworkSettingsState>
  /** A native file picker; the chosen path, or null when cancelled. */
  readonly chooseFile: () => Promise<string | null>
}
