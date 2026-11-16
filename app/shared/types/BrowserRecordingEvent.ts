import type { RecordedBrowserStep } from "./RecordedBrowserStep"

/** What main tells the renderer while a recording runs, on a privileged channel. */
export type BrowserRecordingEvent =
  | { readonly kind: "step"; readonly recordingId: string; readonly workflowId: string; readonly step: RecordedBrowserStep }
  | { readonly kind: "warning"; readonly recordingId: string; readonly workflowId: string; readonly message: string }
  /** A re-pick or re-record replayed the steps before its step: the page is now the user's. */
  | { readonly kind: "replayed"; readonly recordingId: string; readonly workflowId: string }
  /** Stopped from the app, or the user closed the browser. The last event of a recording. */
  | { readonly kind: "ended"; readonly recordingId: string; readonly workflowId: string }
