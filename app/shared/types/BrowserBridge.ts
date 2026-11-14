import type { BrowserChannel } from "./BrowserChannel"
import type { BrowserSettings } from "./BrowserSettings"

/**
 * The `window.__APIWEAVE_BROWSER__` contract: Settings > Browser. Off the IPC
 * router, so no local agent can reach it over MCP — which browser a run drives
 * and whether a window appears on the user's screen is the user's call.
 */
export interface BrowserBridge {
  readonly getSettings: () => Promise<BrowserSettings>
  readonly setSettings: (settings: BrowserSettings) => Promise<BrowserSettings>
  /** Channels that actually start on this machine, in preference order. */
  readonly listInstalled: () => Promise<readonly BrowserChannel[]>
}
