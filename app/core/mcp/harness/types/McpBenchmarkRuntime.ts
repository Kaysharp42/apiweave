import type { InitializedDatabase } from "../../../db"
import type { HandlerDeps } from "../../../ipc/handlers"
import type {
  CollectionRepository,
  EnvironmentRepository,
  NodePresetRepository,
  RunRepository,
  WorkflowRepository,
  WorkspaceRepository,
} from "../../../repositories"

/** A seeded in-memory database wired to the same services and router the app uses. */
export interface McpBenchmarkRuntime {
  readonly db: InitializedDatabase
  readonly deps: HandlerDeps
  readonly repositories: {
    readonly workspaces: WorkspaceRepository
    readonly workflows: WorkflowRepository
    readonly runs: RunRepository
    readonly environments: EnvironmentRepository
    readonly nodePresets: NodePresetRepository
    readonly collections: CollectionRepository
  }
}
