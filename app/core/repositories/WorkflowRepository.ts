import type { KVStore, SqliteRow } from "../db"
import type { Workflow } from "@shared/types/Workflow"
import type { WorkflowEdge } from "@shared/types/WorkflowEdge"
import type { WorkflowNode } from "@shared/types/WorkflowNode"
import type { JsonValue } from "@shared/types/JsonValue"
import type { AssertionItem } from "@shared/types/AssertionItem"
import { generateId } from "../id"
import {
  canonicalizeWorkflowGraph,
  getMapped,
  insertAndRead,
  parseJson,
  queryMapped,
  slugify,
  toJson,
} from "./helpers"

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

/** The one-row read `getById` shares with `create`'s read-back. */
const GET_BY_ID_SQL = `SELECT ${COLUMNS} FROM workflows WHERE id = ?`

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
    const graph = canonicalWorkflow({ nodes: input.nodes ?? [], edges: input.edges ?? [] })
    const settings: WorkflowSettings = {
      description: input.description ?? null,
      tags: input.tags ?? [],
      collectionId: input.collectionId ?? null,
      selectedEnvironmentId: input.selectedEnvironmentId ?? null,
      nodeTemplates: input.nodeTemplates ?? [],
    }
    return insertAndRead(
      this.store,
      "INSERT INTO workflows (id, workspace_id, scopeId, name, slug, graph_json, variables_json, settings_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, input.workspaceId, input.workspaceId, input.name, slugify(input.name, id), toJson(graph), toJson(input.variables ?? {}), toJson(settings)],
      () => this.getById(id),
      `workflow ${id} missing after insert`,
    )
  }

  public transaction<T>(fn: () => T): T {
    return this.store.transaction(fn)
  }

  public getById(workflowId: string): Workflow | undefined {
    return getMapped<WorkflowRow, Workflow>(this.store, GET_BY_ID_SQL, [workflowId], rowToWorkflow)
  }

  public getByIdInWorkspace(workflowId: string, workspaceId: string): Workflow | undefined {
    return getMapped<WorkflowRow, Workflow>(
      this.store,
      `SELECT ${COLUMNS} FROM workflows WHERE id = ? AND workspace_id = ?`,
      [workflowId, workspaceId],
      rowToWorkflow,
    )
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
    const all = queryMapped(
      this.store,
      `SELECT ${COLUMNS} FROM workflows WHERE workspace_id = ? ORDER BY createdAt DESC, id DESC`,
      [workspaceId],
      rowToWorkflow,
    )
    const items = includeAttached ? all : all.filter((workflow) => workflow.collectionId == null)
    return { items, total: items.length }
  }

  public listByCollection(workspaceId: string, collectionId: string): { items: readonly Workflow[]; total: number } {
    const items = queryMapped(
      this.store,
      `SELECT ${COLUMNS} FROM workflows WHERE workspace_id = ? ORDER BY createdAt DESC, id DESC`,
      [workspaceId],
      rowToWorkflow,
    ).filter((workflow) => workflow.collectionId === collectionId)
    return { items, total: items.length }
  }

  public countByCollection(workspaceId: string, collectionId: string): number {
    return this.listByCollection(workspaceId, collectionId).total
  }

  public update(workflowId: string, patch: WorkflowUpdate): Workflow | undefined {
    const existing = this.getById(workflowId)
    if (existing === undefined) {
      return undefined
    }
    const merged: Workflow = { ...existing, ...patch }
    const graph = canonicalWorkflow({ nodes: merged.nodes, edges: merged.edges })
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

  /**
   * Compare-and-swap a whole update against the current revision. Callers that
   * compute a patch from a graph they read earlier (`WorkflowService.patch`)
   * use this so a concurrent edit between the read and the write is reported as
   * a conflict rather than silently overwritten.
   */
  public updateAtRevision(workflowId: string, expectedRevision: number, patch: WorkflowUpdate): Workflow | undefined {
    return this.store.transaction(() => {
      const existing = this.getById(workflowId)
      if (existing === undefined || existing.rev !== expectedRevision) return undefined
      return this.update(workflowId, patch)
    })
  }

  /** Compare-and-swap only one assertion node's rules against the current graph revision. */
  public updateAssertionRules(
    workflowId: string,
    expectedRevision: number,
    assertionNodeId: string,
    mode: "append" | "replace",
    rules: readonly AssertionItem[],
  ): Workflow | undefined {
    return this.store.transaction(() => {
      const existing = this.getById(workflowId)
      if (existing === undefined || existing.rev !== expectedRevision) return undefined

      let found = false
      const nodes = existing.nodes.map((node) => {
        if (node.nodeId !== assertionNodeId || node.type !== "assertion") return node
        found = true
        const current = node.config?.assertions ?? []
        return {
          ...node,
          config: {
            ...(node.config ?? {}),
            assertions: mode === "append" ? [...current, ...rules] : [...rules],
          },
        }
      })
      if (!found) return undefined

      const graph = canonicalWorkflow({ nodes, edges: existing.edges })
      const result = this.store.set(
        "UPDATE workflows SET graph_json = ? WHERE id = ? AND rev = ?",
        [toJson(graph), workflowId, expectedRevision],
      )
      return result.changes === 1 ? this.getById(workflowId) : undefined
    })
  }

  /**
   * Reassign the owning workspace. Deliberately NOT a field of
   * {@link WorkflowUpdate}: `workspace_id` is insert-only for every other
   * caller, and each one of those is a within-workspace edit whose patch must
   * never be able to carry the row out of the workspace the service already
   * authorized. `scopeId` mirrors `workspace_id` on a workspace-scoped row
   * (see `create`), so the two move together or the row's scope goes stale.
   */
  public setWorkspace(workflowId: string, workspaceId: string): Workflow | undefined {
    if (this.getById(workflowId) === undefined) return undefined
    this.store.set(
      "UPDATE workflows SET workspace_id = ?, scopeId = ? WHERE id = ?",
      [workspaceId, workspaceId, workflowId],
    )
    return this.getById(workflowId)
  }

  public delete(workflowId: string): boolean {
    return this.store.delete("DELETE FROM workflows WHERE id = ?", [workflowId]).changes > 0
  }
}

// Trust boundary: the import path (ProjectExportService.importProject) and
// any future MCP/CLI write route arrives here with a graph that the lenient
// `BundleInputSchema` allowed through as `z.array(z.unknown())`. The IPC
// `workflows.create`/`workflows.update` handlers validate `nodes` against the
// strict `WorkflowNodeSchema` before reaching the service, but imports do
// not — so the repository itself enforces canonical `KeyValuePair[]` shape
// on every http-request node's KV fields before persisting. This keeps the
// strict schema honest: zod output validation can only succeed if the data
// was canonical when written, so we canonicalise here rather than relax the
// schema or scatter tolerant reads through the runner.
function canonicalWorkflow(graph: WorkflowGraph): WorkflowGraph {
  return canonicalizeWorkflowGraph(graph as unknown as JsonValue) as unknown as WorkflowGraph
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
