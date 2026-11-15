/** The recording in progress. There is at most one, app-wide. */
export interface BrowserRecordingStatus {
  readonly recordingId: string
  readonly workspaceId: string
  readonly workflowId: string
}
