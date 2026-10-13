import type { ProjectFolderExportResult } from "./ProjectFolderExportResult"
import type { ProjectFolderImportResult } from "./ProjectFolderImportResult"

/**
 * The `window.__APIWEAVE_PROJECT_FOLDERS__` contract: export a project to a
 * folder of JSON files and import one back. Off the IPC router, so no local
 * agent can reach it over MCP: main writes and deletes files on disk, and the
 * folder is always the one the user picks in the native dialog. Each call
 * resolves to null when the dialog is cancelled.
 */
export interface ProjectFolderBridge {
  readonly exportProject: (request: { readonly workspaceId: string; readonly projectId: string }) => Promise<ProjectFolderExportResult | null>
  readonly importProject: (request: { readonly workspaceId: string }) => Promise<ProjectFolderImportResult | null>
}
