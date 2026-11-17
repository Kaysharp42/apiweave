import type { BrowserLocator } from "./BrowserLocator"
import type { RecordedBrowserStep } from "./RecordedBrowserStep"

/** What main tells the renderer while a recording runs, on a privileged channel. */
export type BrowserRecordingEvent =
  | { readonly kind: "step"; readonly recordingId: string; readonly workflowId: string; readonly step: RecordedBrowserStep }
  | { readonly kind: "warning"; readonly recordingId: string; readonly workflowId: string; readonly message: string }
  /** A re-pick or re-record replayed the steps before its step: the page is now the user's. */
  | { readonly kind: "replayed"; readonly recordingId: string; readonly workflowId: string }
  /**
   * A re-pick's element, for its step. An event rather than the answer to the
   * request, so a canvas that was closed or reloaded meanwhile still gets it.
   * Sent once, just before `ended`.
   */
  | {
      readonly kind: "picked"
      readonly recordingId: string
      readonly workflowId: string
      readonly nodeId: string
      readonly locator: BrowserLocator
    }
  /** Stopped from the app, or the user closed the browser. The last event of a recording. */
  | { readonly kind: "ended"; readonly recordingId: string; readonly workflowId: string }
