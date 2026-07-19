import type { JsonValue } from "../../../shared/types/JsonValue"
import type { WorkflowOrderItem } from "../../../shared/types/WorkflowOrderItem"
import { WorkflowEdgeSchema } from "../../../shared/zod-schemas/WorkflowEdgeSchema"
import { WorkflowNodeSchema } from "../../../shared/zod-schemas/WorkflowNodeSchema"
import { WorkflowOrderItemSchema } from "../../../shared/zod-schemas/WorkflowOrderItemSchema"
import type {
  CollectionRepository,
  EnvironmentRepository,
  WorkflowCreate,
  WorkflowRepository,
} from "../repositories"
import type { SecretMetadataStore } from "../secrets/scoped_secret_resolver"
import type { PermissionProvider } from "../auth/PermissionProvider"
import type { SyncProvider } from "../sync/SyncProvider"
import { recordCollectionUpsert, recordEnvironmentUpsert, recordWorkflowUpsert } from "../sync/cloud-mutations"
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

/** Schema version for project bundles. Existing v2 files remain importable. */
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
  readonly nodeTemplates?: readonly JsonValue[]
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

/** A full v2 `.awecollection` bundle with additive project execution metadata. */
export interface ProjectBundle {
  readonly schemaVersion: string
  readonly type: "awecollection"
  readonly project: {
    readonly projectId: string
    readonly name: string
    readonly description: string
    readonly color: string
    readonly workflowOrder?: readonly WorkflowOrderItem[]
    readonly continueOnFail?: boolean
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

export interface ProjectImportOptions {
  readonly targetProjectId?: string
  readonly projectName?: string
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

  async exportProject(workspaceId: string, projectId: string, includeEnvironments = true): Promise<ProjectBundle> {
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
        nodeTemplates: workflow.nodeTemplates.map((template) => toPlain(template)),
      }
    })

    const environmentIds = new Set<string>()
    if (includeEnvironments) {
      for (const workflow of workflows) {
        if (workflow.selectedEnvironmentId) environmentIds.add(workflow.selectedEnvironmentId)
      }
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
        workflowOrder: project.workflowOrder,
        continueOnFail: project.continueOnFail,
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

  async importProject(
    targetWorkspaceId: string,
    bundle: ProjectBundle,
    options: ProjectImportOptions = {},
  ): Promise<ImportResult> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, targetWorkspaceId, "import", RESOURCE_COLLECTIONS)
    const errors = validateBundle(bundle)
    if (errors.length > 0) {
      throw new ValidationError(errors.join("; "))
    }

    const warnings: string[] = []
    const existingProject = options.targetProjectId === undefined
      ? undefined
      : this.collections.getById(options.targetProjectId)
    if (options.targetProjectId !== undefined
      && (existingProject === undefined || existingProject.workspaceId !== targetWorkspaceId)) {
      throw new NotFoundError(`project ${options.targetProjectId} not found`)
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

    const imported = this.collections.transaction(() => {
      const project = existingProject ?? this.collections.create({
        workspaceId: targetWorkspaceId,
        name: options.projectName?.trim() || bundle.project.name || "Imported Project",
        description: bundle.project.description ?? null,
        color: bundle.project.color ?? null,
        continueOnFail: bundle.project.continueOnFail ?? true,
      })
      if (existingProject === undefined) {
        recordCollectionUpsert(this.syncProvider, project)
      }

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
        recordEnvironmentUpsert(this.syncProvider, created)
        envMapping.set(environment.environmentId, created.environmentId)
      }

      const workflowMapping = new Map<string, string>()
      for (const workflow of bundle.workflows ?? []) {
        const oldEnvId = workflow.selectedEnvironmentId
        const mappedEnvId = oldEnvId ? envMapping.get(oldEnvId) : undefined
        const create: WorkflowCreate = {
          workspaceId: targetWorkspaceId,
          name: workflow.name,
          description: workflow.description ?? null,
          nodes: workflow.nodes.map((node) => WorkflowNodeSchema.parse(node)),
          edges: workflow.edges.map((edge) => WorkflowEdgeSchema.parse(edge)),
          variables: workflow.variables ?? {},
          tags: [...(workflow.tags ?? [])],
          collectionId: project.collectionId,
          selectedEnvironmentId: mappedEnvId ?? null,
          nodeTemplates: [...(workflow.nodeTemplates ?? [])],
        }
        const created = this.workflows.create(create)
        recordWorkflowUpsert(this.syncProvider, created)
        workflowMapping.set(workflow.workflowId, created.workflowId)
        if (oldEnvId && !mappedEnvId) {
          warnings.push(`Environment reference '${oldEnvId}' in workflow '${create.name}' could not be mapped`)
        }
      }

      const importedOrder = buildImportedWorkflowOrder(bundle, workflowMapping)
      const workflowOrder = existingProject === undefined
        ? importedOrder
        : appendWorkflowOrder(existingProject.workflowOrder, importedOrder)
      const updatedProject = this.collections.update(project.collectionId, {
        workflowCount: this.workflows.countByCollection(project.collectionId),
        workflowOrder,
      }) ?? project
      recordCollectionUpsert(this.syncProvider, updatedProject)

      return {
        projectId: updatedProject.collectionId,
        workflowCount: workflowMapping.size,
        environmentCount: envMapping.size,
      }
    })

    await this.syncProvider.push()
    return {
      projectId: imported.projectId,
      workflowCount: imported.workflowCount,
      environmentCount: imported.environmentCount,
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
      errors.push(...validateBundle(bundle))
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
      return { valid: false, errors, warnings, stats: emptyStats(bundle) }
    }

    if (bundle.schemaVersion !== SCHEMA_VERSION) {
      warnings.push(
        `Bundle schema version '${bundle.schemaVersion ?? ""}' differs from expected '${SCHEMA_VERSION}' — some features may not import correctly`,
      )
    }

    const workflows = Array.isArray(bundle.workflows) ? bundle.workflows : []

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

function validateBundle(bundle: ProjectBundle): string[] {
  const errors: string[] = []
  if (typeof bundle !== "object" || bundle === null) {
    return ["Bundle must be a JSON object"]
  }
  if (bundle.type !== "awecollection") {
    errors.push("Invalid bundle: type must be 'awecollection'")
  }
  if (typeof bundle.schemaVersion !== "string" || bundle.schemaVersion.length === 0) {
    errors.push("Invalid bundle: missing 'schemaVersion'")
  }
  if (!isJsonRecord(bundle.project) || typeof bundle.project["name"] !== "string") {
    errors.push("Invalid bundle: missing project name")
  } else {
    if (bundle.project["description"] !== undefined && typeof bundle.project["description"] !== "string") {
      errors.push("Invalid bundle: project description must be a string")
    }
    if (bundle.project["color"] !== undefined && typeof bundle.project["color"] !== "string") {
      errors.push("Invalid bundle: project color must be a string")
    }
    if (bundle.project["continueOnFail"] !== undefined && typeof bundle.project["continueOnFail"] !== "boolean") {
      errors.push("Invalid bundle: project continueOnFail must be a boolean")
    }
  }
  const workflowIds = new Set<string>()
  if (!Array.isArray(bundle.workflows)) {
    errors.push("Invalid bundle: missing 'workflows' array")
  } else {
    bundle.workflows.forEach((workflow, workflowIndex) => {
      if (!isJsonRecord(workflow)) {
        errors.push(`Workflow at index ${workflowIndex} must be an object`)
        return
      }
      if (typeof workflow["workflowId"] !== "string" || workflow["workflowId"].length === 0) {
        errors.push(`Workflow at index ${workflowIndex} missing 'workflowId'`)
      } else if (workflowIds.has(workflow["workflowId"])) {
        errors.push(`Duplicate workflow ID: ${workflow["workflowId"]}`)
      } else {
        workflowIds.add(workflow["workflowId"])
      }
      if (typeof workflow["name"] !== "string" || workflow["name"].length === 0) {
        errors.push(`Workflow at index ${workflowIndex} missing 'name'`)
      }
      if (workflow["description"] !== undefined && typeof workflow["description"] !== "string") {
        errors.push(`Workflow at index ${workflowIndex} has an invalid description`)
      }
      if (!isJsonRecord(workflow["variables"])) {
        errors.push(`Workflow at index ${workflowIndex} missing 'variables' object`)
      }
      if (!Array.isArray(workflow["tags"]) || !workflow["tags"].every((tag) => typeof tag === "string")) {
        errors.push(`Workflow at index ${workflowIndex} missing 'tags' array`)
      }
      if (workflow["selectedEnvironmentId"] !== null && typeof workflow["selectedEnvironmentId"] !== "string") {
        errors.push(`Workflow at index ${workflowIndex} has an invalid selectedEnvironmentId`)
      }
      if (workflow["nodeTemplates"] !== undefined && !Array.isArray(workflow["nodeTemplates"])) {
        errors.push(`Workflow at index ${workflowIndex} has an invalid 'nodeTemplates' array`)
      }
      if (!Array.isArray(workflow["nodes"])) {
        errors.push(`Workflow at index ${workflowIndex} missing 'nodes' array`)
        return
      }
      const nodeIds = new Set<string>()
      workflow["nodes"].forEach((node: JsonValue, nodeIndex: number) => {
        if (!isJsonRecord(node) || typeof node["nodeId"] !== "string" || node["nodeId"].length === 0) {
          errors.push(`Workflow ${workflowIndex}, node at index ${nodeIndex} missing 'nodeId'`)
          return
        }
        const parsed = WorkflowNodeSchema.safeParse(node)
        if (!parsed.success) {
          errors.push(`Workflow ${workflowIndex}, node ${nodeIndex}: ${formatValidationIssue(parsed.error.issues[0])}`)
          return
        }
        if (nodeIds.has(parsed.data.nodeId)) {
          errors.push(`Workflow ${workflowIndex}, duplicate node ID: ${parsed.data.nodeId}`)
        }
        nodeIds.add(parsed.data.nodeId)
      })
      if (!Array.isArray(workflow["edges"])) {
        errors.push(`Workflow at index ${workflowIndex} missing 'edges' array`)
        return
      }
      const edgeIds = new Set<string>()
      workflow["edges"].forEach((edge: JsonValue, edgeIndex: number) => {
        const parsed = WorkflowEdgeSchema.safeParse(edge)
        if (!parsed.success) {
          errors.push(`Workflow ${workflowIndex}, edge ${edgeIndex}: ${formatValidationIssue(parsed.error.issues[0])}`)
          return
        }
        if (edgeIds.has(parsed.data.edgeId)) {
          errors.push(`Workflow ${workflowIndex}, duplicate edge ID: ${parsed.data.edgeId}`)
        }
        edgeIds.add(parsed.data.edgeId)
        if (!nodeIds.has(parsed.data.source) || !nodeIds.has(parsed.data.target)) {
          errors.push(`Workflow ${workflowIndex}, edge '${parsed.data.edgeId}' references a missing node`)
        }
      })
    })
  }
  if (isJsonRecord(bundle.project) && bundle.project["workflowOrder"] !== undefined) {
    if (!Array.isArray(bundle.project["workflowOrder"])) {
      errors.push("Invalid bundle: project workflowOrder must be an array")
    } else {
      bundle.project["workflowOrder"].forEach((item, index) => {
        const parsed = WorkflowOrderItemSchema.safeParse(item)
        if (!parsed.success) {
          errors.push(`Project workflow order ${index}: ${formatValidationIssue(parsed.error.issues[0])}`)
        } else if (!workflowIds.has(parsed.data.workflowId)) {
          errors.push(`Project workflow order references missing workflow '${parsed.data.workflowId}'`)
        }
      })
    }
  }
  if (!Array.isArray(bundle.environments)) {
    errors.push("Invalid bundle: missing 'environments' array")
  } else {
    const environmentIds = new Set<string>()
    bundle.environments.forEach((environment, index) => {
      if (!isJsonRecord(environment)) {
        errors.push(`Environment at index ${index} must be an object`)
        return
      }
      if (typeof environment["environmentId"] !== "string" || environment["environmentId"].length === 0) {
        errors.push(`Environment at index ${index} missing 'environmentId'`)
      } else if (environmentIds.has(environment["environmentId"])) {
        errors.push(`Duplicate environment ID: ${environment["environmentId"]}`)
      } else {
        environmentIds.add(environment["environmentId"])
      }
      if (typeof environment["name"] !== "string" || environment["name"].length === 0) {
        errors.push(`Environment at index ${index} missing 'name'`)
      }
      if (!isJsonRecord(environment["variables"])) {
        errors.push(`Environment at index ${index} missing 'variables' object`)
      }
    })
  }
  if (!Array.isArray(bundle.secretReferences)) {
    errors.push("Invalid bundle: missing 'secretReferences' array")
  } else {
    bundle.secretReferences.forEach((reference, index) => {
      if (!isJsonRecord(reference)
        || typeof reference["name"] !== "string"
        || typeof reference["scopeType"] !== "string"
        || typeof reference["scopeId"] !== "string") {
        errors.push(`Secret reference at index ${index} is invalid`)
      }
    })
  }
  assertNoSecretValues(toPlain(bundle))
  return errors
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

function buildImportedWorkflowOrder(
  bundle: ProjectBundle,
  workflowMapping: ReadonlyMap<string, string>,
): WorkflowOrderItem[] {
  const sourceOrder = new Map((bundle.project.workflowOrder ?? []).map((item) => [item.workflowId, item]))
  return bundle.workflows
    .map((workflow, index) => ({ workflow, index, item: sourceOrder.get(workflow.workflowId) }))
    .sort((left, right) => (left.item?.order ?? left.index) - (right.item?.order ?? right.index))
    .map(({ workflow, item }, order) => ({
      workflowId: workflowMapping.get(workflow.workflowId)!,
      order,
      enabled: item?.enabled ?? true,
      continueOnFail: item?.continueOnFail ?? true,
    }))
}

function appendWorkflowOrder(
  existing: readonly WorkflowOrderItem[],
  imported: readonly WorkflowOrderItem[],
): WorkflowOrderItem[] {
  return [
    ...existing.map((item, order) => ({ ...item, order })),
    ...imported.map((item, index) => ({ ...item, order: existing.length + index })),
  ]
}

function formatValidationIssue(issue: { readonly path: readonly PropertyKey[]; readonly message: string } | undefined): string {
  if (issue === undefined) return "invalid value"
  const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""
  return `${path}${issue.message}`
}

function isJsonRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
