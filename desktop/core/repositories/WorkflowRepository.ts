import type { KVStore, SqliteRow } from "../db"
import type { Workflow } from "../../../shared/types/Workflow"
import type { WorkflowEdge } from "../../../shared/types/WorkflowEdge"
import type { WorkflowNode } from "../../../shared/types/WorkflowNode"
import type { JsonValue } from "../../../shared/types/JsonValue"
import { generateId } from "../id"
import { mustExist, parseJson, slugify, toJson } from "./helpers"

export type WorkflowCreate = Pick<Workflow, "workspaceId" | "name"> &
  Partial<
    Pick<
      Workflow,
      "description" | "nodes" | "edges" | "variables" | "tags" | "collectionId" | "selectedEnvironmentId" | "nodeTemplates"
    >
  >

export type WorkflowUpdate = Partial<
  Pick<
    Workflow,
    "name" | "description" | "nodes" | "edges" | "variables" | "tags" | "collectionId" | "selectedEnvironmentId" | "nodeTemplates"
  >
>

const COLUMNS =
  "id, workspace_id, name, graph_json, variables_json, settings_json, rev, createdAt, updatedAt"

interface WorkflowRow extends SqliteRow {
  readonly id: string
  readonly workspace_id: string
  readonly name: string
  readonly graph_json: string
  readonly variables_json: string
  readonly settings_json: string
  readonly rev: number
  readonly createdAt: string
  readonly updatedAt: string
}

interface WorkflowGraph {
  readonly nodes: readonly WorkflowNode[]
  readonly edges: readonly WorkflowEdge[]
}

interface WorkflowSettings {
  readonly description: string | null
  readonly tags: readonly string[]
  readonly collectionId: string | null
  readonly selectedEnvironmentId: string | null
  readonly nodeTemplates: readonly JsonValue[]
}

export class WorkflowRepository {
  public constructor(private readonly store: KVStore) {}

  public create(input: WorkflowCreate): Workflow {
    const id = generateId()
    const graph: WorkflowGraph = { nodes: input.nodes ?? [], edges: input.edges ?? [] }
    const settings: WorkflowSettings = {
      description: input.description ?? null,
      tags: input.tags ?? [],
      collectionId: input.collectionId ?? null,
      selectedEnvironmentId: input.selectedEnvironmentId ?? null,
      nodeTemplates: input.nodeTemplates ?? [],
    }
    this.store.set(
      "INSERT INTO workflows (id, workspace_id, scopeId, name, slug, graph_json, variables_json, settings_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, input.workspaceId, input.workspaceId, input.name, slugify(input.name, id), toJson(graph), toJson(input.variables ?? {}), toJson(settings)],
    )
    return mustExist(this.getById(id), `workflow ${id} missing after insert`)
  }

  public getById(workflowId: string): Workflow | undefined {
    const row = this.store.get<WorkflowRow>(`SELECT ${COLUMNS} FROM workflows WHERE id = ?`, [workflowId])
    return row === undefined ? undefined : rowToWorkflow(row)
  }

  public getByIdInWorkspace(workflowId: string, workspaceId: string): Workflow | undefined {
    const row = this.store.get<WorkflowRow>(`SELECT ${COLUMNS} FROM workflows WHERE id = ? AND workspace_id = ?`, [
      workflowId,
      workspaceId,
    ])
    return row === undefined ? undefined : rowToWorkflow(row)
  }

  /**
   * List a workspace's workflows, newest first. `includeAttached=false` (the
   * default "Workflows" tab) hides workflows already grouped under a project;
   * `true` (the "Projects" view) returns every one.
   *
   * ponytail: collectionId lives in settings_json, so the attachment filter
   * runs in JS after an indexed workspace_id fetch — fine at desktop scale
   * (a workspace holds tens–hundreds of workflows). Promote collectionId to a
   * real column if a workspace ever holds enough to matter.
   */
  public listByWorkspace(workspaceId: string, includeAttached = false): { items: readonly Workflow[]; total: number } {
    const all = this.store
      .query<WorkflowRow>(`SELECT ${COLUMNS} FROM workflows WHERE workspace_id = ? ORDER BY createdAt DESC, id DESC`, [
        workspaceId,
      ])
      .map(rowToWorkflow)
    const items = includeAttached ? all : all.filter((workflow) => workflow.collectionId == null)
    return { items, total: items.length }
  }

  public listByCollection(collectionId: string): { items: readonly Workflow[]; total: number } {
    const items = this.store
      .query<WorkflowRow>(`SELECT ${COLUMNS} FROM workflows ORDER BY createdAt DESC, id DESC`)
      .map(rowToWorkflow)
      .filter((workflow) => workflow.collectionId === collectionId)
    return { items, total: items.length }
  }

  public countByCollection(collectionId: string): number {
    return this.listByCollection(collectionId).total
  }

  public update(workflowId: string, patch: WorkflowUpdate): Workflow | undefined {
    const existing = this.getById(workflowId)
    if (existing === undefined) {
      return undefined
    }
    const merged: Workflow = { ...existing, ...patch }
    const graph: WorkflowGraph = { nodes: merged.nodes, edges: merged.edges }
    const settings: WorkflowSettings = {
      description: merged.description ?? null,
      tags: merged.tags,
      collectionId: merged.collectionId ?? null,
      selectedEnvironmentId: merged.selectedEnvironmentId ?? null,
      nodeTemplates: merged.nodeTemplates,
    }
    this.store.set(
      "UPDATE workflows SET name = ?, slug = ?, graph_json = ?, variables_json = ?, settings_json = ? WHERE id = ?",
      [merged.name, slugify(merged.name, workflowId), toJson(graph), toJson(merged.variables), toJson(settings), workflowId],
    )
    return this.getById(workflowId)
  }

  public delete(workflowId: string): boolean {
    return this.store.delete("DELETE FROM workflows WHERE id = ?", [workflowId]).changes > 0
  }
}

function rowToWorkflow(row: WorkflowRow): Workflow {
  const graph = parseJson<WorkflowGraph>(row.graph_json)
  const settings = parseJson<WorkflowSettings>(row.settings_json)
  return {
    workflowId: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: settings.description,
    nodes: [...graph.nodes],
    edges: [...graph.edges],
    variables: parseJson<Record<string, JsonValue>>(row.variables_json),
    tags: [...settings.tags],
    collectionId: settings.collectionId,
    selectedEnvironmentId: settings.selectedEnvironmentId,
    nodeTemplates: [...settings.nodeTemplates],
    rev: row.rev,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
