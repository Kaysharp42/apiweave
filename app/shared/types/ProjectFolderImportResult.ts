/** What "Import from folder" (and `apiweave run <folder>`) did to the project the folder holds. */
export interface ProjectFolderImportResult {
  readonly folder: string
  readonly projectId: string
  readonly created: number
  /** Workflows rewritten from the folder. Each keeps its previous version in its history (source "import"). */
  readonly updated: number
  readonly unchanged: number
  /** Workflows that were in the project but not in the folder: moved out of the project, not deleted. */
  readonly detached: number
  readonly environmentCount: number
  readonly missingSecrets: readonly string[]
  readonly warnings: readonly string[]
}
