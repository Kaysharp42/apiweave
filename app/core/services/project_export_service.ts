import type { Environment } from "@shared/types/Environment"
import type { JsonValue } from "@shared/types/JsonValue"
import type { ProjectFolderImportResult } from "@shared/types/ProjectFolderImportResult"
import type { Workflow } from "@shared/types/Workflow"
import type { WorkflowNode } from "@shared/types/WorkflowNode"
import type { WorkflowOrderItem } from "@shared/types/WorkflowOrderItem"
import { WorkflowEdgeSchema } from "@shared/zod-schemas/WorkflowEdgeSchema"
import { WorkflowNodeSchema } from "@shared/zod-schemas/WorkflowNodeSchema"
import { WorkflowOrderItemSchema } from "@shared/zod-schemas/WorkflowOrderItemSchema"
import type {
  CollectionRepository,
  EnvironmentRepository,
  WorkflowCreate,
  WorkflowRepository,
} from "../repositories"
import type { SecretMetadataStore } from "../secrets/scoped_secret_resolver"
import { NotFoundError, ValidationError } from "../ipc/errors"
import { callTargetClearedWarning, retargetCallWorkflows } from "./workspace_move"
import type { ScopeResolver } from "./scope_resolver"
import { environmentFileText, stableJson, workflowFileText } from "./project_folder"
import {
  assertNoSecretValues,
  collectSecretRefs,
  findRedactedPlaceholders,
  SECRET_PLACEHOLDER,
  sanitizeExportValue,
  sanitizeVariablesForExport,
  type SecretReference,
} from "./secret_utils"
import { isSecretKey } from "@shared/credentials/credentials"

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

/** A workflow as a bundle (and a project folder) carries it: credentials withheld, ids kept. */
function exportWorkflow(workflow: Workflow): ExportedWorkflow {
  return {
    workflowId: workflow.workflowId,
    name: workflow.name,
    description: workflow.description ?? "",
    nodes: workflow.nodes.map(exportNode),
    edges: workflow.edges.map((edge) => toPlain(edge)),
    variables: sanitizeVariablesForExport(asRecord(toPlain(workflow.variables))),
    tags: workflow.tags,
    selectedEnvironmentId: workflow.selectedEnvironmentId ?? null,
    nodeTemplates: workflow.nodeTemplates.map((template) => sanitizeExportValue(toPlain(template))),
  }
}

function exportNode(node: WorkflowNode): JsonValue {
  const plain = asRecord(toPlain(node))
  if (plain["config"] !== undefined) plain["config"] = sanitizeExportValue(plain["config"])
  return plain
}

/** An environment as a bundle carries it: variables only (secret-named ones withheld), never secrets. */
function exportEnvironment(environment: Environment, workspaceId: string): ExportedEnvironment {
  return {
    environmentId: environment.environmentId,
    name: environment.name,
    description: environment.description ?? null,
    scopeType: "workspace",
    scopeId: workspaceId,
    variables: sanitizeVariablesForExport(asRecord(toPlain(environment.variables))),
    swaggerDocUrl: environment.swaggerDocUrl ?? null,
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
    private readonly scopeResolver: ScopeResolver,
    private readonly secretStore?: SecretMetadataStore,
    private readonly nowIso: () => string = () => new Date().toISOString(),
  ) {}

  async exportProject(workspaceId: string, projectId: string, includeEnvironments = true): Promise<ProjectBundle> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    const project = this.collections.getById(projectId)
    if (project === undefined || project.workspaceId !== workspaceId) {
      throw new NotFoundError(`project ${projectId} not found`)
    }

    const workflows = this.workflows.listByCollection(workspaceId, projectId).items
    const secretReferences: SecretReference[] = []
    const seen = new Set<string>()

    const workflowsExport: ExportedWorkflow[] = workflows.map((workflow) => {
      collectSecretRefs(toPlain(workflow.variables), "workspace", workspaceId, secretReferences, seen)
      for (const node of workflow.nodes) {
        if (node.config !== undefined) collectSecretRefs(toPlain(node.config), "workspace", workspaceId, secretReferences, seen)
      }
      return exportWorkflow(workflow)
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
      environmentsExport.push(exportEnvironment(environment, workspaceId))
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
    await this.scopeResolver.assertWorkspaceVisible(targetWorkspaceId)
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
        envMapping.set(environment.environmentId, created.environmentId)
      }

      const workflowMapping = new Map<string, string>()
      const createdWorkflows: Workflow[] = []
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
        createdWorkflows.push(created)
        workflowMapping.set(workflow.workflowId, created.workflowId)
        if (oldEnvId && !mappedEnvId) {
          warnings.push(`Environment reference '${oldEnvId}' in workflow '${create.name}' could not be mapped`)
        }
      }

      // Second pass, once every imported id is known: a Call Workflow node
      // follows its target to the imported copy; a target outside the bundle
      // stays only if it exists in this workspace, and is cleared otherwise —
      // a dangling id would make the workflow unsaveable and fail the node.
      for (const created of createdWorkflows) {
        const nodes = retargetCallWorkflows(created.nodes, (targetWorkflowId, node) => {
          const mapped = workflowMapping.get(targetWorkflowId)
          if (mapped !== undefined) return mapped
          if (this.workflows.getByIdInWorkspace(targetWorkflowId, targetWorkspaceId)) return targetWorkflowId
          warnings.push(callTargetClearedWarning(node.label ?? node.nodeId, created.name, targetWorkflowId))
          return null
        })
        const changed = nodes.some((node, index) => node !== created.nodes[index])
        if (changed) this.workflows.update(created.workflowId, { nodes })
      }

      const importedOrder = buildImportedWorkflowOrder(bundle, workflowMapping)
      const workflowOrder = existingProject === undefined
        ? importedOrder
        : appendWorkflowOrder(existingProject.workflowOrder, importedOrder)
      const updatedProject = this.collections.update(project.collectionId, {
        workflowCount: this.workflows.countByCollection(targetWorkspaceId, project.collectionId),
        workflowOrder,
      }) ?? project

      return {
        projectId: updatedProject.collectionId,
        workflowCount: workflowMapping.size,
        environmentCount: envMapping.size,
      }
    })

    return {
      projectId: imported.projectId,
      workflowCount: imported.workflowCount,
      environmentCount: imported.environmentCount,
      secretReferences: secretReferences.length,
      missingSecrets,
      warnings,
    }
  }

  /**
   * Make a project match a bundle read from a project folder, matching by id:
   * the project, its environments and its workflows keep the ids the folder
   * names, so the folder can be imported again (after a `git pull`) and update
   * the same rows. A workflow that changed is rewritten through the
   * repository's update, which keeps its previous version in its history
   * (source "import"); an unchanged one is not touched. A workflow in the
   * project but not in the folder is moved out of the project, never deleted.
   *
   * The folder carries no credentials. Where a node's config, a variable or
   * the node templates read the same as the stored value's exported form, the
   * stored value is kept, so a literal credential the export withheld survives
   * a round trip; only a value changed in the folder replaces it.
   */
  async upsertProject(workspaceId: string, bundle: ProjectBundle): Promise<Omit<ProjectFolderImportResult, "folder">> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    const errors = validateBundle(bundle)
    if (errors.length > 0) throw new ValidationError(errors.join("; "))

    const projectId = bundle.project.projectId
    const elsewhere = [
      ...[this.collections.getById(projectId)].map((row) => row && { kind: "project", id: row.collectionId, workspaceId: row.workspaceId }),
      ...bundle.environments.map((environment) => this.environments.getById(environment.environmentId))
        .map((row) => row && { kind: "environment", id: row.environmentId, workspaceId: row.workspaceId }),
      ...bundle.workflows.map((workflow) => this.workflows.getById(workflow.workflowId))
        .map((row) => row && { kind: "workflow", id: row.workflowId, workspaceId: row.workspaceId }),
    ].filter((row) => row !== undefined && row.workspaceId !== workspaceId)
    if (elsewhere.length > 0) {
      throw new ValidationError(
        `this folder's ${elsewhere.map((row) => `${row!.kind} ${row!.id}`).join(", ")} already belong${elsewhere.length === 1 ? "s" : ""} to another workspace. `
          + "A project folder maps to one workspace; to copy the project, export it as a bundle (.awecollection) and import that.",
      )
    }

    const warnings: string[] = []
    const missingSecrets: string[] = []
    for (const ref of bundle.secretReferences) {
      if (!(await this.secretExists(ref.name, workspaceId))) {
        missingSecrets.push(ref.name)
        warnings.push(`Secret '${ref.name}' is not set in this workspace; add it before running the project`)
      }
    }

    const counts = this.collections.transaction(() => {
      this.upsertFolderProject(workspaceId, bundle.project)
      for (const incoming of bundle.environments) this.upsertFolderEnvironment(workspaceId, incoming)

      const folderIds = new Set(bundle.workflows.map((workflow) => workflow.workflowId))
      const previousProjects = new Set<string>()
      const tally = { created: 0, updated: 0, unchanged: 0 }
      for (const incoming of bundle.workflows) {
        tally[this.upsertFolderWorkflow(workspaceId, projectId, incoming, folderIds, previousProjects, warnings)] += 1
      }
      const detached = this.detachWorkflowsNotInFolder(workspaceId, projectId, folderIds, warnings)

      for (const collectionId of previousProjects) {
        this.collections.update(collectionId, { workflowCount: this.workflows.countByCollection(workspaceId, collectionId) })
      }
      this.collections.update(projectId, {
        workflowCount: this.workflows.countByCollection(workspaceId, projectId),
        workflowOrder: buildImportedWorkflowOrder(bundle, new Map([...folderIds].map((id) => [id, id]))),
      })
      return { ...tally, detached }
    })

    return {
      projectId,
      ...counts,
      environmentCount: bundle.environments.length,
      missingSecrets,
      warnings,
    }
  }

  private upsertFolderProject(workspaceId: string, incoming: ProjectBundle["project"]): void {
    const projectFields = {
      name: incoming.name,
      description: incoming.description || null,
      color: incoming.color || null,
    }
    if (this.collections.getById(incoming.projectId) === undefined) {
      this.collections.create({ collectionId: incoming.projectId, workspaceId, ...projectFields })
    } else {
      this.collections.update(incoming.projectId, projectFields)
    }
  }

  private upsertFolderEnvironment(workspaceId: string, incoming: ExportedEnvironment): void {
    const stored = this.environments.getById(incoming.environmentId)
    if (stored !== undefined && environmentFileText(exportEnvironment(stored, workspaceId)) === environmentFileText(incoming)) return
    const fields = {
      name: incoming.name,
      description: incoming.description ?? null,
      swaggerDocUrl: incoming.swaggerDocUrl ?? null,
      variables: keepWithheldVariables(stored?.variables ?? {}, incoming.variables),
    }
    if (stored === undefined) {
      this.environments.create({ environmentId: incoming.environmentId, workspaceId, ...fields, secrets: {} })
    } else {
      this.environments.update(stored.environmentId, fields)
    }
  }

  private upsertFolderWorkflow(
    workspaceId: string,
    projectId: string,
    incoming: ExportedWorkflow,
    folderIds: ReadonlySet<string>,
    previousProjects: Set<string>,
    warnings: string[],
  ): "created" | "updated" | "unchanged" {
    const stored = this.workflows.getById(incoming.workflowId)
    if (stored !== undefined && stored.collectionId === projectId
      && workflowFileText(exportWorkflow(stored)) === workflowFileText(incoming)) {
      return "unchanged"
    }
    const nodes = retargetCallWorkflows(
      incoming.nodes.map((node) => keepWithheldConfig(WorkflowNodeSchema.parse(node), stored)),
      (targetWorkflowId, node) => {
        if (folderIds.has(targetWorkflowId) || this.workflows.getByIdInWorkspace(targetWorkflowId, workspaceId)) return targetWorkflowId
        warnings.push(callTargetClearedWarning(node.label ?? node.nodeId, incoming.name, targetWorkflowId))
        return null
      },
    )
    const fields = folderWorkflowFields(incoming, stored, projectId, nodes)
    const placeholderWarning = withheldPlaceholderWarning(incoming.name, stored, fields)
    if (placeholderWarning !== undefined) warnings.push(placeholderWarning)
    if (stored?.collectionId && stored.collectionId !== projectId) previousProjects.add(stored.collectionId)
    if (stored === undefined) {
      this.workflows.create({ workflowId: incoming.workflowId, workspaceId, ...fields })
      return "created"
    }
    this.workflows.update(stored.workflowId, fields, "import")
    return "updated"
  }

  private detachWorkflowsNotInFolder(workspaceId: string, projectId: string, folderIds: ReadonlySet<string>, warnings: string[]): number {
    let detached = 0
    for (const member of this.workflows.listByCollection(workspaceId, projectId).items) {
      if (folderIds.has(member.workflowId)) continue
      this.workflows.update(member.workflowId, { collectionId: null }, "import")
      warnings.push(`Workflow '${member.name}' is not in the folder; it was moved out of the project (not deleted)`)
      detached += 1
    }
    return detached
  }

  async dryRunImport(targetWorkspaceId: string, bundle: ProjectBundle): Promise<DryRunResult> {
    await this.scopeResolver.assertWorkspaceVisible(targetWorkspaceId)

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

/** A variable whose folder value reads as the stored value's exported form is unchanged: keep the stored (unredacted) value. */
/** The fields a project folder's workflow is written with, keeping node templates the export left unchanged. */
function folderWorkflowFields(incoming: ExportedWorkflow, stored: Workflow | undefined, projectId: string, nodes: Workflow["nodes"]) {
  return {
    name: incoming.name,
    description: incoming.description || null,
    nodes,
    edges: incoming.edges.map((edge) => WorkflowEdgeSchema.parse(edge)),
    variables: keepWithheldVariables(stored?.variables ?? {}, incoming.variables),
    tags: [...incoming.tags],
    collectionId: projectId,
    selectedEnvironmentId: incoming.selectedEnvironmentId,
    nodeTemplates: stored !== undefined && stableJson(exportWorkflow(stored).nodeTemplates ?? []) === stableJson(incoming.nodeTemplates ?? [])
      ? stored.nodeTemplates
      : [...(incoming.nodeTemplates ?? [])],
  }
}

function withheldPlaceholderWarning(
  workflowName: string,
  stored: Workflow | undefined,
  fields: Pick<Workflow, "nodes" | "variables" | "nodeTemplates">,
): string | undefined {
  const placeholders = findRedactedPlaceholders(toPlain({ nodes: fields.nodes, variables: fields.variables, nodeTemplates: fields.nodeTemplates }))
  if (placeholders.length === 0) return undefined
  return `Workflow '${workflowName}' has the placeholder "${SECRET_PLACEHOLDER}" at ${placeholders.join(", ")}: `
    + "the export withheld a credential there. Use a {{secrets.NAME}} reference instead"
    + (stored === undefined ? "" : "; the version before this import is in the workflow's history")
}

function keepWithheldVariables(
  stored: Record<string, JsonValue>,
  incoming: Record<string, JsonValue>,
): Record<string, JsonValue> {
  const exported = sanitizeVariablesForExport(asRecord(toPlain(stored)))
  return Object.fromEntries(Object.entries(incoming).map(([key, value]) => [
    key,
    key in exported && stableJson(exported[key]) === stableJson(value) ? stored[key]! : value,
  ]))
}

/** A node whose config reads as the stored node's exported config keeps the stored (unredacted) config. */
function keepWithheldConfig(node: WorkflowNode, stored: Workflow | undefined): WorkflowNode {
  const previous = stored?.nodes.find((candidate) => candidate.nodeId === node.nodeId)
  if (previous === undefined || previous.type !== node.type) return node
  const exportedConfig = asRecord(exportNode(previous))["config"] ?? null
  return stableJson(exportedConfig) === stableJson(toPlain(node.config ?? null))
    ? ({ ...node, config: previous.config } as WorkflowNode)
    : node
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
