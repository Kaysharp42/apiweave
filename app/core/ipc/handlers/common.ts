import { z } from "zod"
import type { WorkspaceService } from "../../services/workspace_service"
import type { CollectionService } from "../../services/collection_service"
import type { WorkflowService } from "../../services/workflow_service"
import type { EnvironmentService } from "../../services/environment_service"
import type { NodePresetService } from "../../services/node_preset_service"
import type { RunService } from "../../services/run_service"
import type { ProjectRunService } from "../../services/project_run_service"
import type { SecretService } from "../../services/secret_service"
import type { ProjectExportService } from "../../services/project_export_service"
import type { ImportService } from "../../services/import_service"
import type { WorkflowAnalysisService } from "../../services/workflow_analysis_service"
import type { GrpcDiscoveryService } from "../../services/grpc_discovery_service"
import type { AssertionAuthoringService } from "../../services/assertion_authoring_service"
import type { SnapshotRepository } from "../../repositories/SnapshotRepository"
import { NotFoundError } from "../errors"
import type { AppHandlerDeps } from "./app"

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
  readonly workflowAnalysis: WorkflowAnalysisService
  readonly assertionAuthoring: AssertionAuthoringService
  readonly environments: EnvironmentService
  readonly nodePresets: NodePresetService
  readonly runs: RunService
  readonly secrets: SecretService
  readonly projects: ProjectExportService
  readonly imports: ImportService
  /** gRPC discovery over the app's network settings. Absent: one with no custom network settings. */
  readonly grpcDiscovery?: GrpcDiscoveryService
  /** Absent where nothing executes runs (a test router without a scheduler). */
  readonly projectRuns?: ProjectRunService
  /** Snapshot baselines, for accepting the response a run just produced. Absent: the route refuses. */
  readonly snapshots?: SnapshotRepository
  /**
   * The running app's versions, platform and data folder, and the file-manager
   * action About offers. Absent where there is no Electron app to describe — a
   * test router, the MCP tool catalogue.
   */
  readonly app?: AppHandlerDeps
}

/** A method taking no payload — the renderer sends `undefined`, so accept it. */
export const NoInput = z.object({}).strict().optional()

/** `{ items, total }` — the shared list envelope every `list*` service returns. */
export function listResult<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), total: z.number().int().nonnegative() }).strict()
}

/** Who is writing, for the workflow revision a write keeps: the MCP agent that called, or the user in the app. */
export function writeSource(context?: { readonly agent?: string }): string {
  return context?.agent !== undefined ? `agent:${context.agent}` : "canvas"
}

/** The read's value, or null when what it names is gone. Any other failure still throws. */
export async function ifFound<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read
  } catch (error: unknown) {
    if (error instanceof NotFoundError) return null
    throw error
  }
}
