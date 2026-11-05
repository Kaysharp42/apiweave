import { WorkflowEdgeSchema } from "@shared/zod-schemas/WorkflowEdgeSchema"
import { WorkflowNodeSchema } from "@shared/zod-schemas/WorkflowNodeSchema"
import { baseEnvironmentProblem } from "@shared/environments/environment_chain"
import type { CollectionRepository, EnvironmentRepository, NodePresetRepository, WorkflowRepository, WorkspaceRepository } from "../repositories"
import { ValidationError } from "../ipc/errors"
import type { ExportedWorkflow } from "./project_export_service"
import { exportWorkflow, workflowFileText, type WorkspaceSnapshot } from "./workspace_repo_format"
import {
  keepWithheldConfig,
  keepWithheldNodeTemplates,
  keepWithheldPresetConfig,
  keepWithheldVariables,
  withheldPlaceholderWarning,
} from "./withheld_credentials"

/** Applies a validated workspace-repository snapshot as one atomic local import. */
export class WorkspaceRepoImporter {
  public constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly collections: CollectionRepository,
    private readonly workflows: WorkflowRepository,
    private readonly environments: EnvironmentRepository,
    private readonly presets: NodePresetRepository,
  ) {}

  public apply(workspaceId: string, snapshot: WorkspaceSnapshot): readonly string[] {
    if (snapshot.workspace.workspaceId !== workspaceId) {
      throw new ValidationError(`snapshot workspace ${snapshot.workspace.workspaceId} does not match target workspace ${workspaceId}`)
    }

    const warnings: string[] = []
    this.workspaces.transaction(() => this.applyInTransaction(workspaceId, snapshot, warnings))
    return warnings
  }

  private applyInTransaction(workspaceId: string, snapshot: WorkspaceSnapshot, warnings: string[]): void {
    const workspace = this.workspaces.getById(workspaceId)
    if (workspace === undefined) throw new ValidationError(`workspace ${workspaceId} not found`)
    const previousProjects = this.collections.listByWorkspace(workspaceId).items
    const previousWorkflows = this.workflows.listByWorkspace(workspaceId, true).items
    const previousEnvironments = this.environments.listByWorkspace(workspaceId).items
      .filter((environment) => environment.scopeType === "workspace")
    const previousPresets = this.presets.listByWorkspace(workspaceId).items

    this.assertIdsBelongHere(snapshot, workspaceId)
    this.assertWorkflowProjectsExist(snapshot)
    this.assertBaseEnvironmentChain(snapshot.environments)
    if (workspace.name !== snapshot.workspace.name || workspace.description !== snapshot.workspace.description) {
      this.workspaces.update(workspaceId, { name: snapshot.workspace.name, description: snapshot.workspace.description })
    }
    const chosenDefault = chooseDefaultEnvironment(snapshot)
    this.upsertProjects(workspaceId, snapshot)
    this.upsertEnvironments(workspaceId, snapshot, chosenDefault)
    for (const incoming of snapshot.workflows) this.upsertWorkflow(workspaceId, incoming, warnings)
    for (const incoming of snapshot.presets) this.upsertPreset(workspaceId, incoming)
    this.updateWorkflowCounts(snapshot)
    this.deleteMissing(snapshot, previousProjects, previousWorkflows, previousEnvironments, previousPresets)
    this.repairWorkspaceDefault(workspaceId, warnings)
  }

  private upsertProjects(workspaceId: string, snapshot: WorkspaceSnapshot): void {
    for (const incoming of snapshot.projects) {
      const stored = this.collections.getById(incoming.projectId)
      const workflowOrder = incoming.workflowOrder.map((item, order) => ({ ...item, order }))
      const fields = { name: incoming.name, description: incoming.description, color: incoming.color, workflowOrder }
      if (stored === undefined) this.collections.create({ collectionId: incoming.projectId, workspaceId, ...fields })
      else if (stored.name !== fields.name || stored.description !== fields.description || stored.color !== fields.color
        || JSON.stringify(stored.workflowOrder) !== JSON.stringify(workflowOrder)) this.collections.update(incoming.projectId, fields)
    }
  }

  /**
   * Two passes, so a child may name a base that appears later in the snapshot:
   * every environment is written with no base first, then each base link is
   * set. A link that is already right is not rewritten.
   */
  private upsertEnvironments(workspaceId: string, snapshot: WorkspaceSnapshot, chosenDefault: string | undefined): void {
    for (const incoming of snapshot.environments) this.upsertEnvironment(workspaceId, incoming, chosenDefault)
    for (const incoming of snapshot.environments) {
      const stored = this.environments.getById(incoming.environmentId)
      if (stored !== undefined && stored.baseEnvironmentId !== incoming.baseEnvironmentId) {
        this.environments.update(incoming.environmentId, { baseEnvironmentId: incoming.baseEnvironmentId })
      }
    }
    if (chosenDefault !== undefined) this.keepOneDefault(workspaceId, chosenDefault)
  }

  private upsertEnvironment(
    workspaceId: string,
    incoming: WorkspaceSnapshot["environments"][number],
    chosenDefault: string | undefined,
  ): void {
    const stored = this.environments.getById(incoming.environmentId)
    const variables = keepWithheldVariables(stored?.variables ?? {}, incoming.variables)
    const fields = {
      name: incoming.name,
      description: incoming.description,
      swaggerDocUrl: incoming.swaggerDocUrl,
      variables,
      isDefault: chosenDefault === undefined ? stored?.isDefault ?? false : incoming.environmentId === chosenDefault,
    }
    if (stored === undefined) {
      this.environments.create({ environmentId: incoming.environmentId, workspaceId, ...fields, baseEnvironmentId: null, secrets: {} })
      return
    }
    const storedFields = {
      name: stored.name,
      description: stored.description,
      swaggerDocUrl: stored.swaggerDocUrl,
      variables: stored.variables,
      isDefault: stored.isDefault,
    }
    if (JSON.stringify(storedFields) !== JSON.stringify(fields)) this.environments.update(incoming.environmentId, fields)
  }

  private keepOneDefault(workspaceId: string, chosenDefault: string): void {
    for (const environment of this.environments.listByWorkspace(workspaceId).items) {
      if (environment.scopeType === "workspace" && environment.environmentId !== chosenDefault && environment.isDefault) {
        this.environments.update(environment.environmentId, { isDefault: false })
      }
    }
  }

  private upsertWorkflow(workspaceId: string, incoming: WorkspaceSnapshot["workflows"][number], warnings: string[]): void {
    const stored = this.workflows.getById(incoming.workflowId)
    const file: ExportedWorkflow = {
      workflowId: incoming.workflowId,
      name: incoming.name,
      description: incoming.description,
      nodes: incoming.nodes,
      edges: incoming.edges,
      variables: incoming.variables,
      tags: incoming.tags,
      selectedEnvironmentId: incoming.selectedEnvironmentId,
      nodeTemplates: incoming.nodeTemplates,
    }
    if (stored !== undefined && stored.collectionId === incoming.projectId
      && workflowFileText(exportWorkflow(stored)) === workflowFileText(file)) return

    const nodes = incoming.nodes.map((node) => keepWithheldConfig(WorkflowNodeSchema.parse(node), stored))
    const fields = {
      name: incoming.name,
      description: incoming.description,
      nodes,
      edges: incoming.edges.map((edge) => WorkflowEdgeSchema.parse(edge)),
      variables: keepWithheldVariables(stored?.variables ?? {}, incoming.variables),
      tags: [...incoming.tags],
      collectionId: incoming.projectId,
      selectedEnvironmentId: incoming.selectedEnvironmentId,
      nodeTemplates: keepWithheldNodeTemplates(stored, incoming.nodeTemplates),
    }
    const warning = withheldPlaceholderWarning(incoming.name, stored, fields)
    if (warning !== undefined) warnings.push(warning)
    if (stored === undefined) this.workflows.create({ workflowId: incoming.workflowId, workspaceId, ...fields })
    else this.workflows.update(incoming.workflowId, fields, "git")
  }

  private upsertPreset(workspaceId: string, incoming: WorkspaceSnapshot["presets"][number]): void {
    const stored = this.presets.getById(incoming.presetId)
    const config = keepWithheldPresetConfig(stored, incoming.nodeType, incoming.config)
    const fields = { name: incoming.name, nodeType: incoming.nodeType, config }
    if (stored === undefined) {
      this.presets.create({ presetId: incoming.presetId, workspaceId, ...fields })
      return
    }
    if (stored.name !== fields.name || stored.nodeType !== fields.nodeType || JSON.stringify(stored.config) !== JSON.stringify(fields.config)) {
      this.presets.update(incoming.presetId, fields)
    }
  }

  private updateWorkflowCounts(snapshot: WorkspaceSnapshot): void {
    for (const project of snapshot.projects) {
      const stored = this.collections.getById(project.projectId)
      const workflowCount = snapshot.workflows.filter((workflow) => workflow.projectId === project.projectId).length
      if (stored !== undefined && stored.workflowCount !== workflowCount) this.collections.update(project.projectId, { workflowCount })
    }
  }

  private deleteMissing(
    snapshot: WorkspaceSnapshot,
    previousProjects: ReturnType<CollectionRepository["listByWorkspace"]>["items"],
    previousWorkflows: ReturnType<WorkflowRepository["listByWorkspace"]>["items"],
    previousEnvironments: ReturnType<EnvironmentRepository["listByWorkspace"]>["items"],
    previousPresets: ReturnType<NodePresetRepository["listByWorkspace"]>["items"],
  ): void {
    this.deleteAbsent(snapshot.workflows.map((workflow) => workflow.workflowId), previousWorkflows, (workflow) => workflow.workflowId, (id) => this.workflows.delete(id))
    this.deleteAbsent(snapshot.projects.map((project) => project.projectId), previousProjects, (project) => project.collectionId, (id) => this.collections.delete(id))
    this.deleteAbsent(
      snapshot.environments.map((environment) => environment.environmentId),
      previousEnvironments.filter((environment) => environment.scopeType === "workspace"),
      (environment) => environment.environmentId,
      (id) => {
        this.detachEnvironmentReferences(snapshot.workspace.workspaceId, id)
        this.environments.delete(id)
      },
    )
    this.deleteAbsent(snapshot.presets.map((preset) => preset.presetId), previousPresets, (preset) => preset.presetId, (id) => this.presets.delete(id))
  }

  /** Deletes every stored record whose id the snapshot no longer holds, through `remove`. */
  private deleteAbsent<T>(keptIds: readonly string[], stored: readonly T[], idOf: (item: T) => string, remove: (id: string) => void): void {
    const kept = new Set(keptIds)
    for (const item of stored) {
      const id = idOf(item)
      if (!kept.has(id)) remove(id)
    }
  }

  private detachEnvironmentReferences(workspaceId: string, environmentId: string): void {
    for (const workflow of this.workflows.listByWorkspace(workspaceId, true).items) {
      if (workflow.selectedEnvironmentId === environmentId) {
        this.workflows.update(workflow.workflowId, { selectedEnvironmentId: null })
      }
    }
    for (const sibling of this.environments.listByWorkspace(workspaceId).items) {
      if (sibling.environmentId !== environmentId && sibling.baseEnvironmentId === environmentId) {
        this.environments.update(sibling.environmentId, { baseEnvironmentId: null })
      }
    }
  }

  private repairWorkspaceDefault(workspaceId: string, warnings: string[]): void {
    const environments = this.environments.listByWorkspace(workspaceId).items
      .filter((environment) => environment.scopeType === "workspace")
    if (environments.length === 0 || environments.some((environment) => environment.isDefault)) return
    const chosen = [...environments].sort((left, right) => left.environmentId.localeCompare(right.environmentId))[0]!
    this.environments.update(chosen.environmentId, { isDefault: true })
    warnings.push(`No default environment was set; '${chosen.environmentId}' is now the workspace default.`)
  }

  private assertIdsBelongHere(snapshot: WorkspaceSnapshot, workspaceId: string): void {
    const conflicts = [
      ...this.foreignIds(snapshot.projects.map((project) => project.projectId), "project", (id) => this.projectIsElsewhere(id, workspaceId)),
      ...this.foreignIds(snapshot.workflows.map((workflow) => workflow.workflowId), "workflow", (id) => this.workflowIsElsewhere(id, workspaceId)),
      ...this.foreignIds(snapshot.environments.map((environment) => environment.environmentId), "environment", (id) => this.environmentIsElsewhere(id, workspaceId)),
      ...this.foreignIds(snapshot.presets.map((preset) => preset.presetId), "preset", (id) => this.presetIsElsewhere(id, workspaceId)),
    ]
    if (conflicts.length > 0) throw new ValidationError(`snapshot ${conflicts.join(", ")} already belong outside workspace ${workspaceId}`)
  }

  /** `<kind> <id>` for every id of `ids` that another workspace already owns. */
  private foreignIds(ids: readonly string[], kind: string, isElsewhere: (id: string) => boolean): string[] {
    return ids.filter(isElsewhere).map((id) => `${kind} ${id}`)
  }

  private assertBaseEnvironmentChain(environments: WorkspaceSnapshot["environments"]): void {
    const problem = baseEnvironmentProblem(environments)
    if (problem !== undefined) throw new ValidationError(`snapshot environments: ${problem}`)
  }

  private assertWorkflowProjectsExist(snapshot: WorkspaceSnapshot): void {
    const projectIds = new Set(snapshot.projects.map((project) => project.projectId))
    for (const workflow of snapshot.workflows) {
      if (workflow.projectId !== null && !projectIds.has(workflow.projectId)) {
        throw new ValidationError(`workflows/*--${workflow.workflowId}.json names project ${workflow.projectId}, but there is no projects/*--${workflow.projectId}.json`)
      }
    }
  }

  private projectIsElsewhere(projectId: string, workspaceId: string): boolean {
    const stored = this.collections.getById(projectId)
    return stored !== undefined && stored.workspaceId !== workspaceId
  }

  private workflowIsElsewhere(workflowId: string, workspaceId: string): boolean {
    const stored = this.workflows.getById(workflowId)
    return stored !== undefined && stored.workspaceId !== workspaceId
  }

  private environmentIsElsewhere(environmentId: string, workspaceId: string): boolean {
    const stored = this.environments.getById(environmentId)
    return stored !== undefined && (stored.workspaceId !== workspaceId || stored.scopeType !== "workspace")
  }

  private presetIsElsewhere(presetId: string, workspaceId: string): boolean {
    const stored = this.presets.getById(presetId)
    return stored !== undefined && stored.workspaceId !== workspaceId
  }
}

function chooseDefaultEnvironment(snapshot: WorkspaceSnapshot): string | undefined {
  return snapshot.environments.filter((environment) => environment.isDefault)
    .map((environment) => environment.environmentId).sort()[0]
}
