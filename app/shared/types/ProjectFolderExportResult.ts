/** What "Export to folder" did: paths are relative to `folder`, sorted. */
export interface ProjectFolderExportResult {
  readonly folder: string
  readonly workflowCount: number
  readonly environmentCount: number
  /** Files created or changed. An unchanged file is not rewritten. */
  readonly written: readonly string[]
  /** Files the previous export wrote that no longer belong to the project (a deleted or renamed workflow). */
  readonly removed: readonly string[]
}
