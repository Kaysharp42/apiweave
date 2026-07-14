import { z } from "zod"
import type { WorkspaceService } from "../../services/workspace_service"
import type { CollectionService } from "../../services/collection_service"
import type { WorkflowService } from "../../services/workflow_service"
import type { EnvironmentService } from "../../services/environment_service"
import type { RunService } from "../../services/run_service"
import type { SecretService } from "../../services/secret_service"
import type { ProjectExportService } from "../../services/project_export_service"
import type { ImportService } from "../../services/import_service"
import type { CloudSyncControl } from "../../services/cloud_sync_control"

/**
 * The service bundle every handler module registers against. Constructed once at
 * the composition root (main.ts / MCP host) with the concrete repositories and
 * providers, then handed to {@link registerAllHandlers}. Constructor DI only — no
 * module singletons (acceptance criterion).
 */
export interface HandlerDeps {
  readonly workspaces: WorkspaceService
  readonly collections: CollectionService
  readonly workflows: WorkflowService
  readonly environments: EnvironmentService
  readonly runs: RunService
  readonly secrets: SecretService
  readonly projects: ProjectExportService
  readonly imports: ImportService
  readonly cloud?: CloudSyncControl
}

/** A method taking no payload — the renderer sends `undefined`, so accept it. */
export const NoInput = z.object({}).strict().optional()

/** `{ items, total }` — the shared list envelope every `list*` service returns. */
export function listResult<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), total: z.number().int().nonnegative() }).strict()
}
