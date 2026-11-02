import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { SecretMetadata } from "../../secrets/scoped_secret_resolver"
import type { SecretUpsert, SecretWriteStore } from "../../secrets/SecretStore"
import {
  CollectionRepository,
  EnvironmentRepository,
  NodePresetRepository,
  RunRepository,
  WorkflowRepository,
  WorkspaceRepository,
} from "../../repositories"
import { registerAllHandlers, type HandlerDeps } from "../../ipc/handlers"
import { IpcRouter } from "../../ipc/router"
import { AssertionAuthoringService } from "../../services/assertion_authoring_service"
import { CollectionService } from "../../services/collection_service"
import { EnvironmentService } from "../../services/environment_service"
import { ImportService } from "../../services/import_service"
import { NodePresetService } from "../../services/node_preset_service"
import { ProjectExportService } from "../../services/project_export_service"
import { RunService } from "../../services/run_service"
import { ScopeResolver } from "../../services/scope_resolver"
import { SecretService } from "../../services/secret_service"
import { WorkflowAnalysisService } from "../../services/workflow_analysis_service"
import { WorkflowService } from "../../services/workflow_service"
import { WorkspaceService } from "../../services/workspace_service"
import { createMcpServer } from "../server"
import { createMcpBenchmarkDatabase } from "./database"
import type { McpBenchmarkRuntime } from "./types"

const FIXED_TIME = "2026-09-09T00:00:00.000Z"

/** Metadata-only secret store: the harness never seals or reads a value. */
class EmptySecretWriteStore implements SecretWriteStore {
  public put(input: SecretUpsert): SecretMetadata {
    return {
      secretId: `${input.scopeType}/${input.scopeId}/${input.name}`,
      name: input.name,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      keyId: input.keyId,
      ...(input.label === undefined ? {} : { label: input.label }),
      createdAt: FIXED_TIME,
      updatedAt: FIXED_TIME,
    }
  }

  public remove(): boolean {
    return false
  }

  public listByScope(): SecretMetadata[] {
    return []
  }

  public getByScopeAndName(): SecretMetadata | null {
    return null
  }

  public getCiphertext(): null {
    return null
  }
}

/** Builds the real service bundle over a fresh in-memory database. */
export function createMcpBenchmarkRuntime(): McpBenchmarkRuntime {
  const db = createMcpBenchmarkDatabase()
  const workspaces = new WorkspaceRepository(db.kvStore)
  const workflows = new WorkflowRepository(db.kvStore)
  const runs = new RunRepository(db.kvStore)
  const environments = new EnvironmentRepository(db.kvStore)
  const nodePresets = new NodePresetRepository(db.kvStore)
  const collections = new CollectionRepository(db.kvStore)
  const scopeResolver = new ScopeResolver({
    workspaceExists: (id) => workspaces.getById(id) !== undefined,
    environmentExists: (id) => environments.getById(id) !== undefined,
  })
  const workflowService = new WorkflowService(workflows, scopeResolver, collections, environments)
  const runService = new RunService(runs, scopeResolver)
  const secretStore = new EmptySecretWriteStore()
  const deps: HandlerDeps = {
    workspaces: new WorkspaceService(workspaces, workflows, scopeResolver),
    collections: new CollectionService(collections, workflows, scopeResolver),
    workflows: workflowService,
    workflowAnalysis: new WorkflowAnalysisService(workflowService, runService),
    assertionAuthoring: new AssertionAuthoringService(workflowService, runService),
    environments: new EnvironmentService(environments, scopeResolver),
    nodePresets: new NodePresetService(nodePresets, scopeResolver),
    runs: runService,
    secrets: new SecretService(secretStore, scopeResolver, environments, new Uint8Array(32)),
    projects: new ProjectExportService(collections, workflows, environments, scopeResolver, secretStore, () => FIXED_TIME),
    imports: new ImportService(workflows, environments, collections, scopeResolver),
  }
  return {
    db,
    deps,
    repositories: { workspaces, workflows, runs, environments, nodePresets, collections },
  }
}

/** Opens a real in-memory MCP client over the runtime's router. */
export async function openMcpBenchmarkClient(
  deps: HandlerDeps,
): Promise<{ readonly client: Client; readonly close: () => Promise<void> }> {
  const router = new IpcRouter()
  registerAllHandlers(router, deps)
  const server = createMcpServer(router, "benchmark")
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport as never)
  const client = new Client({ name: "apiweave-mcp-baseline", version: "1" })
  await client.connect(clientTransport as never)
  return {
    client,
    close: async () => {
      await client.close()
      await server.close()
    },
  }
}
