import type { JsonValue } from "../../../shared/types/JsonValue"
import type {
  CollectionRepository,
  EnvironmentRepository,
  WorkflowCreate,
  WorkflowRepository,
} from "../repositories"
import type { SecretMetadataStore } from "../secrets/scoped_secret_resolver"
import type { PermissionProvider } from "../auth/PermissionProvider"
import type { SyncProvider } from "../sync/SyncProvider"
import { NotFoundError, ValidationError } from "../ipc/errors"
import { RESOURCE_COLLECTIONS } from "../auth/permissions"
import { authorizeWorkspace } from "./authorize"
import type { ScopeResolver } from "./scope_resolver"
import {
  assertNoSecretValues,
  collectSecretRefs,
  isSecretKey,
  sanitizeVariablesForExport,
  type SecretReference,
} from "./secret_utils"

/** Schema version for v2 exports (byte-compat with Python `project_export_service`). */
export const SCHEMA_VERSION = "2.0"

/** A workflow as serialized into a v2 bundle — variables/config sanitized. */
export interface ExportedWorkflow {
  readonly workflowId: string
  readonly name: string
  readonly description: string
  readonly nodes: readonly JsonValue[]
  readonly edges: readonly JsonValue[]
  readonly variables: Record<string, JsonValue>
  readonly tags: readonly string[]
  readonly selectedEnvironmentId: string | null
}

/** An environment as serialized into a v2 bundle — variables only, never secrets. */
export interface ExportedEnvironment {
  readonly environmentId: string
  readonly name: string
  readonly description: string | null
  readonly scopeType: string
  readonly scopeId: string
  readonly variables: Record<string, JsonValue>
  readonly swaggerDocUrl: string | null
}

/** A full v2 `.awecollection` bundle. */
export interface ProjectBundle {
  readonly schemaVersion: string
  readonly type: "awecollection"
  readonly project: {
    readonly projectId: string
    readonly name: string
    readonly description: string
    readonly color: string
  }
  readonly workflows: readonly ExportedWorkflow[]
  readonly environments: readonly ExportedEnvironment[]
  readonly secretReferences: readonly SecretReference[]
  readonly metadata: {
    readonly exportedAt: string
    readonly schemaVersion: string
    readonly workflowCount: number
    readonly environmentCount: number
    readonly secretReferenceCount: number
  }
}

export interface ImportResult {
  readonly projectId: string
  readonly workflowCount: number
  readonly environmentCount: number
  readonly secretReferences: number
  readonly missingSecrets: readonly string[]
  readonly warnings: readonly string[]
}

export interface DryRunResult {
  readonly valid: boolean
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
  readonly stats: {
    readonly schemaVersion: string
    readonly workflows: number
    readonly environments: number
    readonly secretReferences: number
    readonly missingSecrets: number
  }
}

function toPlain(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue
}

function asRecord(value: JsonValue): Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {}
}

/**
 * Project (collection) export/import for the v2 `.awecollection` format. Ported
 * from Python `project_export_service`. Secret *references* only — ciphertext,
 * private keys, and plaintext NEVER enter a bundle (`assertNoSecretValues` fails
 * closed if a forbidden storage key ever reaches the export layer).
 *
 * `nowIso` is injected so exports are deterministic under test (the harness seeds
 * a fixed clock); default reads the wall clock.
 */
export class ProjectExportService {
  constructor(
    private readonly collections: CollectionRepository,
    private readonly workflows: WorkflowRepository,
    private readonly environments: EnvironmentRepository,
    private readonly syncProvider: SyncProvider,
    private readonly permissions: PermissionProvider,
    private readonly scopeResolver: ScopeResolver,
    private readonly secretStore?: SecretMetadataStore,
    private readonly nowIso: () => string = () => new Date().toISOString(),
  ) {}

  async exportProject(workspaceId: string, projectId: string): Promise<ProjectBundle> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "export", RESOURCE_COLLECTIONS)
    const project = this.collections.getById(projectId)
    if (project === undefined || project.workspaceId !== workspaceId) {
      throw new NotFoundError(`project ${projectId} not found`)
    }

    const workflows = this.workflows.listByCollection(projectId).items
    const secretReferences: SecretReference[] = []
    const seen = new Set<string>()

    const workflowsExport: ExportedWorkflow[] = workflows.map((workflow) => {
      const rawVariables = toPlain(workflow.variables)
      collectSecretRefs(rawVariables, "workspace", workspaceId, secretReferences, seen)
      const nodes = workflow.nodes.map((node) => {
        const plain = asRecord(toPlain(node))
        if (plain["config"] !== undefined) {
          collectSecretRefs(plain["config"], "workspace", workspaceId, secretReferences, seen)
          plain["config"] = sanitizeVariablesForExport(asRecord(plain["config"]))
        }
        return plain as JsonValue
      })
      return {
        workflowId: workflow.workflowId,
        name: workflow.name,
        description: workflow.description ?? "",
        nodes,
        edges: workflow.edges.map((edge) => toPlain(edge)),
        variables: sanitizeVariablesForExport(asRecord(rawVariables)),
        tags: workflow.tags,
        selectedEnvironmentId: workflow.selectedEnvironmentId ?? null,
      }
    })

    const environmentIds = new Set<string>()
    for (const workflow of workflows) {
      if (workflow.selectedEnvironmentId) environmentIds.add(workflow.selectedEnvironmentId)
    }

    const environmentsExport: ExportedEnvironment[] = []
    for (const environmentId of [...environmentIds].sort()) {
      const environment = this.environments.getById(environmentId)
      if (environment === undefined) continue
      const rawVars = asRecord(toPlain(environment.variables))
      for (const [key, value] of Object.entries(rawVars)) {
        if (isSecretKey(key) && typeof value === "string") {
          const dedupeKey = `${key} workspace ${workspaceId}`
          if (!seen.has(dedupeKey)) {
            seen.add(dedupeKey)
            secretReferences.push({ name: key, scopeType: "workspace", scopeId: workspaceId })
          }
        }
      }
      environmentsExport.push({
        environmentId: environment.environmentId,
        name: environment.name,
        description: environment.description ?? null,
        scopeType: "workspace",
        scopeId: workspaceId,
        variables: sanitizeVariablesForExport(rawVars),
        swaggerDocUrl: environment.swaggerDocUrl ?? null,
      })
    }

    const bundle: ProjectBundle = {
      schemaVersion: SCHEMA_VERSION,
      type: "awecollection",
      project: {
        projectId: project.projectId ?? project.collectionId,
        name: project.name,
        description: project.description ?? "",
        color: project.color ?? "#3B82F6",
      },
      workflows: workflowsExport,
      environments: environmentsExport,
      secretReferences,
      metadata: {
        exportedAt: this.nowIso(),
        schemaVersion: SCHEMA_VERSION,
        workflowCount: workflowsExport.length,
        environmentCount: environmentsExport.length,
        secretReferenceCount: secretReferences.length,
      },
    }

    // Fail-closed: no secret-storage field may ever have reached the bundle.
    assertNoSecretValues(toPlain(bundle))
    return bundle
  }

  async importProject(targetWorkspaceId: string, bundle: ProjectBundle): Promise<ImportResult> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, targetWorkspaceId, "import", RESOURCE_COLLECTIONS)
    validateBundleStructure(bundle)

    const warnings: string[] = []
    const project = this.collections.create({
      workspaceId: targetWorkspaceId,
      name: bundle.project?.name ?? "Imported Project",
      description: bundle.project?.description ?? null,
      color: bundle.project?.color ?? null,
    })

    const envMapping = new Map<string, string>()
    for (const environment of bundle.environments ?? []) {
      const created = this.environments.create({
        workspaceId: targetWorkspaceId,
        name: environment.name ?? "Imported Environment",
        description: environment.description ?? null,
        swaggerDocUrl: environment.swaggerDocUrl ?? null,
        variables: environment.variables ?? {},
        secrets: {},
      })
      if (environment.environmentId) envMapping.set(environment.environmentId, created.environmentId)
    }

    let importedWorkflows = 0
    for (const workflow of bundle.workflows ?? []) {
      const oldEnvId = workflow.selectedEnvironmentId
      const mappedEnvId = oldEnvId ? envMapping.get(oldEnvId) : undefined
      const create: WorkflowCreate = {
        workspaceId: targetWorkspaceId,
        name: workflow.name ?? "Imported Workflow",
        description: workflow.description ?? null,
        nodes: (workflow.nodes ?? []) as unknown as NonNullable<WorkflowCreate["nodes"]>,
        edges: (workflow.edges ?? []) as unknown as NonNullable<WorkflowCreate["edges"]>,
        variables: workflow.variables ?? {},
        tags: [...(workflow.tags ?? [])],
        collectionId: project.collectionId,
        selectedEnvironmentId: mappedEnvId ?? null,
      }
      this.workflows.create(create)
      if (oldEnvId && !mappedEnvId) {
        warnings.push(`Environment reference '${oldEnvId}' in workflow '${create.name}' could not be mapped`)
      }
      importedWorkflows += 1
    }

    const secretReferences = bundle.secretReferences ?? []
    const missingSecrets: string[] = []
    for (const ref of secretReferences) {
      if (!ref.name) continue
      const exists = await this.secretExists(ref.name, targetWorkspaceId)
      if (!exists) {
        missingSecrets.push(ref.name)
        warnings.push(
          `Secret '${ref.name}' referenced in export does not exist in target workspace — it must be re-created manually`,
        )
      }
    }

    await this.syncProvider.push()
    return {
      projectId: project.collectionId,
      workflowCount: importedWorkflows,
      environmentCount: envMapping.size,
      secretReferences: secretReferences.length,
      missingSecrets,
      warnings,
    }
  }

  async dryRunImport(targetWorkspaceId: string, bundle: ProjectBundle): Promise<DryRunResult> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, targetWorkspaceId, "import", RESOURCE_COLLECTIONS)

    const errors: string[] = []
    const warnings: string[] = []
    try {
      validateBundleStructure(bundle)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
      return { valid: false, errors, warnings, stats: emptyStats(bundle) }
    }

    if (bundle.schemaVersion !== SCHEMA_VERSION) {
      warnings.push(
        `Bundle schema version '${bundle.schemaVersion ?? ""}' differs from expected '${SCHEMA_VERSION}' — some features may not import correctly`,
      )
    }

    const workflows = bundle.workflows ?? []
    workflows.forEach((workflow, index) => {
      if (workflow.name === undefined) errors.push(`Workflow at index ${index} missing 'name'`)
      if (workflow.nodes === undefined) {
        errors.push(`Workflow at index ${index} missing 'nodes'`)
        return
      }
      const nodeIds = new Set<string>()
      workflow.nodes.forEach((node, nodeIndex) => {
        const nodeId = asRecord(node)["nodeId"]
        if (typeof nodeId !== "string" || nodeId.length === 0) {
          errors.push(`Workflow ${index}, node at index ${nodeIndex} missing 'nodeId'`)
        } else if (nodeIds.has(nodeId)) {
          errors.push(`Workflow ${index}, duplicate node ID: ${nodeId}`)
        } else {
          nodeIds.add(nodeId)
        }
      })
    })

    const secretReferences = bundle.secretReferences ?? []
    let missing = 0
    for (const ref of secretReferences) {
      if (!ref.name) continue
      if (!(await this.secretExists(ref.name, targetWorkspaceId))) {
        missing += 1
        warnings.push(`Secret '${ref.name}' not found in target workspace`)
      }
    }
    if (missing > 0) {
      warnings.push(
        `${missing} secret reference(s) missing in target workspace — they must be re-created manually after import`,
      )
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      stats: {
        schemaVersion: bundle.schemaVersion ?? "unknown",
        workflows: workflows.length,
        environments: (bundle.environments ?? []).length,
        secretReferences: secretReferences.length,
        missingSecrets: missing,
      },
    }
  }

  private async secretExists(name: string, workspaceId: string): Promise<boolean> {
    if (this.secretStore === undefined) return false
    const hit = await this.secretStore.getByScopeAndName("workspace", workspaceId, name)
    return hit != null
  }
}

function validateBundleStructure(bundle: ProjectBundle): void {
  if (typeof bundle !== "object" || bundle === null) {
    throw new ValidationError("Bundle must be a JSON object")
  }
  if (bundle.workflows === undefined) {
    throw new ValidationError("Invalid bundle: missing 'workflows' key")
  }
  // Fail closed if any secret-storage field is present anywhere in the bundle.
  assertNoSecretValues(toPlain(bundle))
}

function emptyStats(bundle: ProjectBundle): DryRunResult["stats"] {
  return {
    schemaVersion: bundle?.schemaVersion ?? "unknown",
    workflows: 0,
    environments: 0,
    secretReferences: 0,
    missingSecrets: 0,
  }
}
