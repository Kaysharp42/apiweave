import type { KVStore, SqliteRow } from "../db"
import { SIDE_TABLE_THRESHOLD_BYTES } from "../db"
import type { Run } from "@shared/types/Run"
import type { RunResult } from "@shared/types/RunResult"
import type { JsonValue } from "@shared/types/JsonValue"
import { generateId } from "../id"
import { mustExist, parseJson, toJson } from "./helpers"

export type RunCreate = Pick<Run, "workspaceId" | "workflowId"> &
  Partial<Pick<Run, "status" | "trigger" | "variables" | "selectedEnvironmentId" | "nodeStatuses">>

export type RunUpdate = Partial<
  Pick<
    Run,
    | "status"
    | "trigger"
    | "variables"
    | "nodeStatuses"
    | "results"
    | "selectedEnvironmentId"
    | "startedAt"
    | "completedAt"
    | "duration"
    | "error"
    | "failedNodes"
    | "failureMessage"
    | "resumeFromRunId"
    | "resumeFromNodeIds"
    | "resumeMode"
  >
>

/** Where a persisted node-response body ended up. */
export type BodyStorage = "inline" | "side"

const TERMINAL_STATUSES: ReadonlySet<Run["status"]> = new Set(["completed", "failed", "cancelled", "interrupted"])

const COLUMNS =
  "id, workspace_id, workflow_id, status, node_statuses_json, extracted_variables_json, response_metadata_json, startedAt, completedAt, rev, createdAt, updatedAt"

interface RunRow extends SqliteRow {
  readonly id: string
  readonly workspace_id: string
  readonly workflow_id: string
  readonly status: string
  readonly node_statuses_json: string
  readonly extracted_variables_json: string
  readonly response_metadata_json: string
  readonly startedAt: string | null
  readonly completedAt: string | null
  readonly rev: number
  readonly createdAt: string
  readonly updatedAt: string
}

/** Everything on a Run that has no dedicated column rides in this blob. */
interface RunMetadata {
  readonly selectedEnvironmentId: string | null
  readonly trigger: Run["trigger"]
  readonly results: readonly RunResult[]
  readonly duration: number | null
  readonly error: string | null
  readonly failedNodes: readonly string[] | null
  readonly failureMessage: string | null
  readonly resumeFromRunId: string | null
  readonly resumeFromNodeIds: readonly string[] | null
  readonly resumeMode: "single" | "all-failed" | null
}

export class RunRepository {
  public constructor(private readonly store: KVStore) {}

  public create(input: RunCreate): Run {
    const id = generateId()
    const metadata: RunMetadata = {
      selectedEnvironmentId: input.selectedEnvironmentId ?? null,
      trigger: input.trigger ?? "manual",
      results: [],
      duration: null,
      error: null,
      failedNodes: null,
      failureMessage: null,
      resumeFromRunId: null,
      resumeFromNodeIds: null,
      resumeMode: null,
    }
    this.store.set(
      "INSERT INTO runs (id, workspace_id, workflow_id, scopeId, status, node_statuses_json, extracted_variables_json, response_metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        input.workspaceId,
        input.workflowId,
        input.workspaceId,
        input.status ?? "pending",
        toJson(input.nodeStatuses ?? {}),
        toJson(input.variables ?? {}),
        toJson(metadata),
      ],
    )
    return mustExist(this.getById(id), `run ${id} missing after insert`)
  }

  public getById(runId: string): Run | undefined {
    const row = this.store.get<RunRow>(`SELECT ${COLUMNS} FROM runs WHERE id = ?`, [runId])
    return row === undefined ? undefined : rowToRun(row)
  }

  // Reads are scoped by workspace as well as workflow: RunService authorizes the
  // caller's workspaceId but the workflowId is caller-supplied, so binding both
  // columns stops a caller from reading another workspace's runs via a foreign
  // workflowId (existence-hiding: a mismatch just returns empty/undefined).
  public listByWorkflow(workflowId: string, workspaceId: string): { items: readonly Run[]; total: number } {
    const items = this.store
      .query<RunRow>(
        `SELECT ${COLUMNS} FROM runs WHERE workflow_id = ? AND workspace_id = ? ORDER BY createdAt DESC, id DESC`,
        [workflowId, workspaceId],
      )
      .map(rowToRun)
    return { items, total: items.length }
  }

  public listByWorkspace(workspaceId: string): { items: readonly Run[]; total: number } {
    const items = this.store
      .query<RunRow>(`SELECT ${COLUMNS} FROM runs WHERE workspace_id = ? ORDER BY createdAt DESC, id DESC`, [workspaceId])
      .map(rowToRun)
    return { items, total: items.length }
  }

  public getLatestRun(workflowId: string, workspaceId: string): Run | undefined {
    const row = this.store.get<RunRow>(
      `SELECT ${COLUMNS} FROM runs WHERE workflow_id = ? AND workspace_id = ? ORDER BY createdAt DESC, id DESC LIMIT 1`,
      [workflowId, workspaceId],
    )
    return row === undefined ? undefined : rowToRun(row)
  }

  public getLatestFailedRun(workflowId: string, workspaceId: string): Run | undefined {
    const row = this.store.get<RunRow>(
      `SELECT ${COLUMNS} FROM runs WHERE workflow_id = ? AND workspace_id = ? AND status = 'failed' ORDER BY createdAt DESC, id DESC LIMIT 1`,
      [workflowId, workspaceId],
    )
    return row === undefined ? undefined : rowToRun(row)
  }

  /**
   * All runs still in a non-terminal state (`pending` or `running`), oldest
   * first. The scheduler's `reconcileOnStartup` marks each as `interrupted` —
   * never auto-resumes (decision: re-run is the user's choice).
   */
  public listNonTerminal(): readonly Run[] {
    return this.store
      .query<RunRow>(`SELECT ${COLUMNS} FROM runs WHERE status IN ('pending', 'running') ORDER BY createdAt ASC, id ASC`)
      .map(rowToRun)
  }

  public update(runId: string, patch: RunUpdate): Run | undefined {
    const existing = this.getById(runId)
    if (existing === undefined) {
      return undefined
    }
    this.writeRun({ ...existing, ...patch })
    return this.getById(runId)
  }

  /**
   * Port of `RunRepository.update_status`: stamps `startedAt` on first
   * transition to running and `completedAt`/`duration` on any terminal state.
   *
   * Field-level write (decision #6b): touches only the status/timestamp columns
   * and patches `duration`/`error` into the metadata blob — it never rewrites
   * `node_statuses_json`/`extracted_variables_json`, so per-node progress patched
   * by {@link appendNodeStatus} is never clobbered by a status transition.
   */
  public updateStatus(runId: string, status: Run["status"], error?: string): Run | undefined {
    const existing = this.getById(runId)
    if (existing === undefined) {
      return undefined
    }
    const now = new Date().toISOString()
    const startedAt = status === "running" && existing.startedAt == null ? now : existing.startedAt ?? null
    const terminal = TERMINAL_STATUSES.has(status)
    const completedAt = terminal ? now : existing.completedAt ?? null
    const duration =
      terminal && startedAt != null ? Date.parse(completedAt ?? now) - Date.parse(startedAt) : existing.duration ?? null
    this.store.set(
      "UPDATE runs SET status = ?, startedAt = ?, completedAt = ?, " +
        "response_metadata_json = json_set(response_metadata_json, '$.duration', ?, '$.error', ?) WHERE id = ?",
      [status, startedAt, completedAt, duration, error ?? existing.error ?? null, runId],
    )
    return this.getById(runId)
  }

  /**
   * JSON-patch one node's status entry into `node_statuses_json` (decision #6b):
   * a targeted `json_set` on that single column, NOT a whole-row replace. The
   * executor (Task 14) calls this per node completion; concurrent status/variable
   * writes never race on the whole row.
   */
  public appendNodeStatus(runId: string, nodeId: string, entry: JsonValue): void {
    this.store.set("UPDATE runs SET node_statuses_json = json_set(node_statuses_json, ?, json(?)) WHERE id = ?", [
      `$.${JSON.stringify(nodeId)}`,
      toJson(entry),
      runId,
    ])
  }

  /**
   * Merge extracted variables into `extracted_variables_json` via `json_patch`
   * (RFC 7386 object merge) — targeted column write, whole row untouched.
   */
  public mergeExtractedVariables(runId: string, variables: Record<string, JsonValue>): void {
    this.store.set("UPDATE runs SET extracted_variables_json = json_patch(extracted_variables_json, json(?)) WHERE id = ?", [
      toJson(variables),
      runId,
    ])
  }

  public updateResults(runId: string, results: readonly RunResult[]): Run | undefined {
    return this.update(runId, { results: [...results] })
  }

  public delete(runId: string): boolean {
    return this.store.delete("DELETE FROM runs WHERE id = ?", [runId]).changes > 0
  }

  public deleteByWorkflow(workflowId: string): number {
    return this.store.delete("DELETE FROM runs WHERE workflow_id = ?", [workflowId]).changes
  }

  /**
   * Persist a node's response body. Bodies at/above the side-table threshold
   * spill to `run_responses` (decision #7); smaller ones stay inline in the
   * run's results and are NOT written here.
   */
  public putNodeBody(runId: string, nodeId: string, body: Buffer): BodyStorage {
    if (body.length < SIDE_TABLE_THRESHOLD_BYTES) {
      return "inline"
    }
    this.store.set(
      "INSERT INTO run_responses (run_id, node_id, body, size) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(run_id, node_id) DO UPDATE SET body = excluded.body, size = excluded.size",
      [runId, nodeId, body, body.length],
    )
    return "side"
  }

  public getNodeBody(runId: string, nodeId: string): Buffer | undefined {
    const row = this.store.get<{ body: Buffer } & SqliteRow>(
      "SELECT body FROM run_responses WHERE run_id = ? AND node_id = ?",
      [runId, nodeId],
    )
    return row?.body
  }

  private writeRun(run: Run): void {
    const metadata: RunMetadata = {
      selectedEnvironmentId: run.selectedEnvironmentId ?? null,
      trigger: run.trigger,
      results: run.results,
      duration: run.duration ?? null,
      error: run.error ?? null,
      failedNodes: run.failedNodes ?? null,
      failureMessage: run.failureMessage ?? null,
      resumeFromRunId: run.resumeFromRunId ?? null,
      resumeFromNodeIds: run.resumeFromNodeIds ?? null,
      resumeMode: run.resumeMode ?? null,
    }
    this.store.set(
      "UPDATE runs SET status = ?, node_statuses_json = ?, extracted_variables_json = ?, response_metadata_json = ?, startedAt = ?, completedAt = ? WHERE id = ?",
      [
        run.status,
        toJson(run.nodeStatuses),
        toJson(run.variables),
        toJson(metadata),
        run.startedAt ?? null,
        run.completedAt ?? null,
        run.runId,
      ],
    )
  }
}

function rowToRun(row: RunRow): Run {
  const metadata = parseJson<RunMetadata>(row.response_metadata_json)
  return {
    runId: row.id,
    workspaceId: row.workspace_id,
    workflowId: row.workflow_id,
    selectedEnvironmentId: metadata.selectedEnvironmentId,
    status: row.status as Run["status"],
    trigger: metadata.trigger,
    variables: parseJson<Record<string, JsonValue>>(row.extracted_variables_json),
    results: [...metadata.results],
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    duration: metadata.duration,
    error: metadata.error,
    failedNodes: metadata.failedNodes === null ? null : [...metadata.failedNodes],
    failureMessage: metadata.failureMessage,
    nodeStatuses: parseJson<Record<string, JsonValue>>(row.node_statuses_json),
    resumeFromRunId: metadata.resumeFromRunId,
    resumeFromNodeIds: metadata.resumeFromNodeIds === null ? null : [...metadata.resumeFromNodeIds],
    resumeMode: metadata.resumeMode,
    rev: row.rev,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
