import { gunzipSync, gzipSync } from "node:zlib"
import type { KVStore, SqliteRow } from "../db"
import { WORKFLOW_REVISION_INTERVAL_MS, WORKFLOW_REVISION_MAX_AGE_MS, WORKFLOW_REVISIONS_KEPT } from "../db"
import type { Workflow } from "@shared/types/Workflow"
import type { WorkflowRevision } from "@shared/types/WorkflowRevision"
import type { WorkflowRevisionSummary } from "@shared/types/WorkflowRevisionSummary"
import { generateId } from "../id"
import { parseJson } from "./helpers"

/** Who made a workflow write: `canvas`, `agent:<name>`, `git`, `import` or `restore` (`cloud` remains for old revisions). */
export type WorkflowWriteSource = string

const SUMMARY_COLUMNS = "id, workflow_id, source, workflow_rev, node_count, edge_count, createdAt"

interface RevisionRow extends SqliteRow {
  readonly id: string
  readonly workflow_id: string
  readonly source: string
  readonly workflow_rev: number
  readonly node_count: number
  readonly edge_count: number
  readonly createdAt: string
}

interface RevisionContentRow extends RevisionRow {
  readonly snapshot: Buffer
}

/**
 * Earlier versions of workflows (migration 021). Every write that replaces a
 * workflow's content calls {@link capture} with the workflow as it is just
 * before the write, inside the write's transaction. Local only: never synced.
 */
export class WorkflowRevisionRepository {
  public constructor(private readonly store: KVStore) {}

  /**
   * Keep `current` as a revision before `source` replaces it — unless it is
   * already the newest revision, or the same writer is writing again within a
   * few minutes of its last snapshot: canvas auto-save fires every 700 ms of
   * editing, and an agent session is many small patches. A change of writer is
   * always snapshotted first, so the state before an agent started stays
   * reachable instead of being pruned out by the agent's own patches.
   */
  public capture(current: Workflow, source: WorkflowWriteSource): void {
    const now = Date.now()
    const newest = this.store.get<{ source: string; createdAt: string; snapshot: Buffer } & SqliteRow>(
      "SELECT source, createdAt, snapshot FROM workflow_revisions WHERE workflow_id = ? ORDER BY createdAt DESC, rowid DESC LIMIT 1",
      [current.workflowId],
    )
    if (
      newest !== undefined &&
      newest.source === source &&
      now - Date.parse(newest.createdAt) < WORKFLOW_REVISION_INTERVAL_MS
    ) {
      return
    }
    const content = JSON.stringify(snapshotOf(current))
    if (newest !== undefined && gunzipSync(newest.snapshot).toString("utf8") === content) return

    this.store.set(
      "INSERT INTO workflow_revisions (id, workflow_id, source, workflow_rev, node_count, edge_count, snapshot, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        generateId(),
        current.workflowId,
        source,
        current.rev,
        current.nodes.length,
        current.edges.length,
        gzipSync(content),
        new Date(now).toISOString(),
      ],
    )
    this.store.delete(
      "DELETE FROM workflow_revisions WHERE workflow_id = ? AND (createdAt < ? OR id NOT IN " +
        "(SELECT id FROM workflow_revisions WHERE workflow_id = ? ORDER BY createdAt DESC, rowid DESC LIMIT ?))",
      [current.workflowId, new Date(now - WORKFLOW_REVISION_MAX_AGE_MS).toISOString(), current.workflowId, WORKFLOW_REVISIONS_KEPT],
    )
  }

  /** A workflow's revisions, newest first, without their content. */
  public list(workflowId: string): WorkflowRevisionSummary[] {
    return this.store
      .query<RevisionRow>(
        `SELECT ${SUMMARY_COLUMNS} FROM workflow_revisions WHERE workflow_id = ? ORDER BY createdAt DESC, rowid DESC`,
        [workflowId],
      )
      .map(rowToSummary)
  }

  /** One revision of `workflowId`, with its content. */
  public get(workflowId: string, revisionId: string): WorkflowRevision | undefined {
    const row = this.store.get<RevisionContentRow>(
      `SELECT ${SUMMARY_COLUMNS}, snapshot FROM workflow_revisions WHERE id = ? AND workflow_id = ?`,
      [revisionId, workflowId],
    )
    if (row === undefined) return undefined
    return { ...rowToSummary(row), snapshot: parseJson<WorkflowRevision["snapshot"]>(gunzipSync(row.snapshot).toString("utf8")) }
  }
}

/** The content a revision keeps and a restore writes back: not the workflow's project, environment or identity. */
function snapshotOf(workflow: Workflow): WorkflowRevision["snapshot"] {
  return {
    name: workflow.name,
    description: workflow.description ?? null,
    nodes: workflow.nodes,
    edges: workflow.edges,
    variables: workflow.variables,
    tags: workflow.tags,
    nodeTemplates: workflow.nodeTemplates,
  }
}

function rowToSummary(row: RevisionRow): WorkflowRevisionSummary {
  return {
    revisionId: row.id,
    workflowId: row.workflow_id,
    source: row.source,
    workflowRev: row.workflow_rev,
    nodeCount: row.node_count,
    edgeCount: row.edge_count,
    createdAt: row.createdAt,
  }
}
