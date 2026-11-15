import type { BrowserChannel } from "./BrowserChannel"
import type { BrowserRecordingEvent } from "./BrowserRecordingEvent"
import type { BrowserRecordingRequest } from "./BrowserRecordingRequest"
import type { BrowserRecordingStatus } from "./BrowserRecordingStatus"
import type { BrowserSettings } from "./BrowserSettings"

/**
 * The `window.__APIWEAVE_BROWSER__` contract: Settings > Browser and
 * recording. Off the IPC router, so no local agent can reach it over MCP —
 * which browser a run drives, whether a window appears on the user's screen,
 * and what the user types into one are the user's business.
 */
export interface BrowserBridge {
  readonly getSettings: () => Promise<BrowserSettings>
  readonly setSettings: (settings: BrowserSettings) => Promise<BrowserSettings>
  /** Channels that actually start on this machine, in preference order. */
  readonly listInstalled: () => Promise<readonly BrowserChannel[]>
  /** Open a browser on the start page and record what the user does into steps. One recording at a time. */
  readonly startRecording: (request: BrowserRecordingRequest) => Promise<BrowserRecordingStatus>
  /** Stop the recording; its `ended` event follows. */
  readonly stopRecording: () => Promise<void>
  /** The recording in progress, if any: a reloaded renderer picks it back up. */
  readonly recordingStatus: () => Promise<BrowserRecordingStatus | null>
  readonly onRecording: (callback: (event: BrowserRecordingEvent) => void) => () => void
}
