/** The recording in progress. There is at most one, app-wide. */
export interface BrowserRecordingStatus {
  readonly recordingId: string
  readonly workspaceId: string
  readonly workflowId: string
  /**
   * `record` from a start address; `rerecord` replaces the steps from
   * `nodeId` on; `repick` picks a new element for `nodeId` and records nothing.
   */
  readonly operation: "record" | "rerecord" | "repick"
  /** The step a re-record or a re-pick starts from. */
  readonly nodeId?: string
}
