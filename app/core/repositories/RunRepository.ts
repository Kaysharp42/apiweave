import type { KVStore, SqliteRow } from "../db"
import { SIDE_TABLE_THRESHOLD_BYTES } from "../db"
import type { Run } from "@shared/types/Run"
import type { RunResult } from "@shared/types/RunResult"
import type { ResolvedSecretInfo } from "@shared/types/ResolvedSecretInfo"
import type { JsonValue } from "@shared/types/JsonValue"
import { generateId } from "../id"
import { mustExist, parseJson, toJson } from "./helpers"
import { AssertionEvaluationSchema } from "@shared/zod-schemas/AssertionEvaluationSchema"
import { RunResultSchema } from "@shared/zod-schemas/RunResultSchema"

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
    | "resolvedSecrets"
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
  readonly resolvedSecrets: readonly ResolvedSecretInfo[]
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
      resolvedSecrets: [],
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

  /** Persist the executor's final evidence without rewriting per-node progress. */
  public updateExecutionEvidence(
    runId: string,
    evidence: {
      readonly results: readonly RunResult[]
      readonly extractedVariables: Readonly<Record<string, JsonValue>>
      readonly failedNodes: readonly string[]
      readonly failureMessage: string | null
    },
  ): Run | undefined {
    this.store.set(
      "UPDATE runs SET extracted_variables_json = json(?), " +
        "response_metadata_json = json_set(response_metadata_json, '$.results', json(?), '$.failedNodes', json(?), '$.failureMessage', ?) WHERE id = ?",
      [
        toJson(evidence.extractedVariables),
        toJson(evidence.results),
        toJson(evidence.failedNodes),
        evidence.failureMessage,
        runId,
      ],
    )
    return this.getById(runId)
  }

  /**
   * Patch safe secret-resolution metadata (`$.resolvedSecrets`) into the run's
   * metadata blob — a targeted `json_set`, NOT a whole-row write, so it never
   * clobbers per-node progress. Holds names + scope + a resolved flag only;
   * never secret values/ciphertext. For masked-secret debug confidence (5.3).
   */
  public setResolvedSecrets(runId: string, secrets: readonly ResolvedSecretInfo[]): void {
    this.store.set("UPDATE runs SET response_metadata_json = json_set(response_metadata_json, '$.resolvedSecrets', json(?)) WHERE id = ?", [
      toJson(secrets),
      runId,
    ])
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
      resolvedSecrets: run.resolvedSecrets ?? [],
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
  const metadata = normalizeRunMetadata(parseJson<unknown>(row.response_metadata_json))
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
    resolvedSecrets: [...metadata.resolvedSecrets],
    rev: row.rev,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function normalizeRunMetadata(value: unknown): RunMetadata {
  const metadata = isRecord(value) ? value : {}
  return {
    selectedEnvironmentId: typeof metadata["selectedEnvironmentId"] === "string" ? metadata["selectedEnvironmentId"] : null,
    trigger: metadata["trigger"] === "schedule" ? "schedule" : "manual",
    results: normalizeRunResults(metadata["results"]),
    duration: typeof metadata["duration"] === "number" ? metadata["duration"] : null,
    error: typeof metadata["error"] === "string" ? metadata["error"] : null,
    failedNodes: Array.isArray(metadata["failedNodes"])
      ? metadata["failedNodes"].filter((item): item is string => typeof item === "string")
      : null,
    failureMessage: typeof metadata["failureMessage"] === "string" ? metadata["failureMessage"] : null,
    resumeFromRunId: typeof metadata["resumeFromRunId"] === "string" ? metadata["resumeFromRunId"] : null,
    resumeFromNodeIds: Array.isArray(metadata["resumeFromNodeIds"])
      ? metadata["resumeFromNodeIds"].filter((item): item is string => typeof item === "string")
      : null,
    resumeMode: metadata["resumeMode"] === "single" || metadata["resumeMode"] === "all-failed"
      ? metadata["resumeMode"]
      : null,
    resolvedSecrets: Array.isArray(metadata["resolvedSecrets"])
      ? metadata["resolvedSecrets"].flatMap((item) => {
          if (!isRecord(item) || typeof item["name"] !== "string" || typeof item["resolved"] !== "boolean") return []
          const scopeType = item["scopeType"] === "environment" || item["scopeType"] === "workspace"
            ? item["scopeType"]
            : null
          return [{ name: item["name"], resolved: item["resolved"], scopeType }]
        })
      : [],
  }
}

function normalizeRunResults(value: unknown): RunResult[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item)) return []
    const assertions = Array.isArray(item["assertions"])
      ? item["assertions"].flatMap((assertion, index) => {
          const current = AssertionEvaluationSchema.safeParse(assertion)
          if (current.success) return [current.data]
          if (!isRecord(assertion)) return []
          const outcome = assertion["outcome"] === "pass" ? "pass" as const : "fail" as const
          return [{
            ruleIndex: index,
            source: "prev" as const,
            path: "",
            operator: "equals" as const,
            sourceNodeId: null,
            expectedState: "legacy" as const,
            expectedType: null,
            actualState: "not-evaluated" as const,
            actualType: null,
            outcome,
            reasonCode: "legacy-result" as const,
          }]
        })
      : item["assertions"] === null
        ? null
        : undefined
    const candidate = {
      ...item,
      ...(assertions === undefined ? {} : { assertions }),
    }
    const parsed = RunResultSchema.safeParse(candidate)
    return parsed.success ? [parsed.data] : []
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
