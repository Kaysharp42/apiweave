import type { Run } from "@shared/types/Run"
import type { JsonValue } from "@shared/types/JsonValue"
import type { NodeEvidencePage } from "@shared/types/NodeEvidencePage"
import type { RunResult } from "@shared/types/RunResult"
import type { RunCreate, RunRepository, RunSummaryRow } from "../repositories"
import { buildNodeEvidencePage, openHistoryCursor, sealHistoryCursor, type EvidenceSelection } from "./run_evidence"
import { RUN_WAIT_DEFAULT_MS, RUN_WAIT_MAX_MS } from "./read_budgets"
import type { PermissionProvider } from "../auth/PermissionProvider"
import type { SyncProvider } from "../sync/SyncProvider"
import { ConflictError, NotFoundError } from "../ipc/errors"
import { abortError } from "../ipc/router"
import type { RunEventBroker } from "../runner/run_event_broker"
import { RESOURCE_RUNS, RESOURCE_WORKFLOWS } from "../auth/permissions"
import { authorizeWorkspace } from "./authorize"
import type { ScopeResolver } from "./scope_resolver"

/**
 * The run-execution seam. The in-process {@link RunScheduler} satisfies it
 * structurally; injecting it (rather than importing the scheduler here) keeps the
 * heavy executor/http graph out of the service and its unit tests. When absent,
 * `createRun` just persists a pending row and `cancel` marks it cancelled — the
 * behaviour the field-level-write tests rely on.
 */
export interface RunTrigger {
  enqueue(request: {
    workspaceId: string
    workflowId: string
    variables?: Readonly<Record<string, unknown>>
    selectedEnvironmentId?: string | null
    startNodeIds?: readonly string[]
  }): string
  cancel(runId: string): boolean
}

/**
 * Minimal broker surface the wait needs — subscribe plus nothing else. Typed
 * structurally so unit tests can hand a real `RunEventBroker` or a fake.
 */
export interface RunEventSource {
  subscribe(listener: (event: { readonly kind: string; readonly runId: string }) => void): () => void
}

export interface RunCreateOptions {
  /** Caller-supplied idempotency key for safe retries (see `createRun`). */
  readonly operationId?: string
  /** Bounded wait after enqueue: 0 returns immediately, otherwise waits up to this long. */
  readonly waitMs?: number
}

export interface RunWaitOptions {
  readonly signal?: AbortSignal
}

/**
 * Workspace-scoped run history + the field-level write surface the executor
 * drives. Ported from Python `run_service`.
 *
 * User-facing reads (get/list/cancel) authorize through scope + permission. The
 * executor-internal progress writes (`appendNodeStatus`, `mergeExtractedVariables`,
 * `completeRun`) are NOT re-authorized per call — the run was authorized at
 * `createRun`, and re-resolving scope on every node completion is pure overhead.
 * They delegate to the repository's JSON-patch methods (decision #6b): each write
 * touches a single column, never a whole-row replace. The IPC event emission for
 * these is Task 15's concern, not this service's.
 */
export class RunService {
  private readonly createDedup = new Map<string, { canonical: string; runId: string }>()
  private readonly createInflight = new Map<string, Promise<Run>>()

  constructor(
    private readonly runs: RunRepository,
    private readonly syncProvider: SyncProvider,
    private readonly permissions: PermissionProvider,
    private readonly scopeResolver: ScopeResolver,
    private readonly trigger?: RunTrigger,
    private readonly broker?: RunEventBroker | RunEventSource,
  ) {}

  async createRun(
    workspaceId: string,
    input: Omit<RunCreate, "workspaceId">,
    options: RunCreateOptions = {},
    waitOptions: RunWaitOptions = {},
  ): Promise<Run> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "run", RESOURCE_WORKFLOWS)
    // Immediate by default at the service layer: existing callers (renderer via
    // waitMs:0, unit tests, scheduler field writes) expect the queued snapshot
    // back, not a bounded wait. The IPC/MCP `runs.create` handler applies the
    // agent-facing 10s default when the caller omits `waitMs`.
    const waitMs = options.waitMs === undefined ? 0 : normalizeWaitMs(options.waitMs)
    if (options.operationId !== undefined) {
      const run = await this.createRunDeduped(workspaceId, input, options.operationId, waitMs, waitOptions.signal)
      return run
    }
    const run = await this.enqueueRun(workspaceId, input)
    if (waitMs === 0) return run
    return this.waitForRun(workspaceId, run.runId, waitMs, waitOptions)
  }

  /**
   * Awaitable run observation (MCP optimization phase 4). Event-driven when a
   * broker is wired: subscribe first, re-read current state, then wait — so a
   * completion landing between lookup and subscription is never missed. Falls
   * back to bounded DB polling when no broker is present (unit tests, or a run
   * that predates this process). Bounded by `waitMs` (0 = immediate return);
   * a timeout or an aborted wait returns/throws without touching the run — a
   * disconnect or deadline never starts another run and never cancels this one.
   * Both the initial lookup and the final retrieval are authorized.
   */
  async waitForRun(
    workspaceId: string,
    runId: string,
    waitMs: number,
    options: RunWaitOptions = {},
  ): Promise<Run> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_RUNS)
    const bounded = normalizeWaitMs(waitMs)
    const signal = options.signal
    if (signal?.aborted === true) throw abortError("wait cancelled")
    if (this.broker === undefined) {
      return this.waitByPolling(workspaceId, runId, bounded, signal)
    }
    return this.waitByBroker(workspaceId, runId, bounded, this.broker, signal)
  }

  async get(workspaceId: string, runId: string): Promise<Run> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_RUNS)
    return this.mustGet(workspaceId, runId)
  }

  async listByWorkflow(workspaceId: string, workflowId: string): Promise<{ items: readonly Run[]; total: number }> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_RUNS)
    return this.runs.listByWorkflow(workflowId, workspaceId)
  }

  async listByWorkspace(workspaceId: string): Promise<{ items: readonly Run[]; total: number }> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_RUNS)
    return this.runs.listByWorkspace(workspaceId)
  }

  async getLatest(workspaceId: string, workflowId: string): Promise<Run | undefined> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_RUNS)
    return this.runs.getLatestRun(workflowId, workspaceId)
  }

  async getLatestFailed(workspaceId: string, workflowId: string): Promise<Run | undefined> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_RUNS)
    return this.runs.getLatestFailedRun(workflowId, workspaceId)
  }

  /**
   * Bounded compact history: identity, status, timing and failure counts per
   * row, never per-node results. Pages with an opaque filter-bound
   * revision-safe cursor, like workflow search.
   */
  async history(
    workspaceId: string,
    filters: { readonly workflowId?: string; readonly status?: Run["status"] },
    limit: number,
    cursor: string | undefined,
  ): Promise<{ items: readonly RunSummaryRow[]; nextCursor: string | null }> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_RUNS)
    const snapshot = this.runs.runHistorySnapshot(workspaceId, filters)
    const after = cursor === undefined
      ? undefined
      : openHistoryCursor(cursor, { workspaceId, workflowId: filters.workflowId, status: filters.status }, snapshot).after
    const page = this.runs.listRunSummaries(workspaceId, filters, after, limit)
    const last = page.items[page.items.length - 1]
    return {
      items: page.items,
      nextCursor: page.hasMore && last !== undefined
        ? sealHistoryCursor({
          workspaceId,
          ...(filters.workflowId !== undefined ? { workflowId: filters.workflowId } : {}),
          ...(filters.status !== undefined ? { status: filters.status } : {}),
          limit,
          after: { createdAt: last.createdAt, runId: last.runId },
          snapshot: page.snapshot,
        })
        : null,
    }
  }

  /**
   * Targeted evidence for a small node set. Selection runs before the
   * transport's redaction pass, so masking keeps its original context.
   */
  async getNodeEvidence(workspaceId: string, runId: string, selection: EvidenceSelection): Promise<NodeEvidencePage> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_RUNS)
    return buildNodeEvidencePage(this.mustGet(workspaceId, runId), selection)
  }

  async cancel(workspaceId: string, runId: string): Promise<Run> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "cancel", RESOURCE_RUNS)
    this.mustGet(workspaceId, runId)
    // Abort a live/queued run at the scheduler (the executor stops at its next
    // checkpoint and emits run.finished); then mark the row cancelled. For a run
    // the scheduler doesn't track (already terminal, or no scheduler), this write
    // is the whole cancel.
    this.trigger?.cancel(runId)
    const updated = this.runs.updateStatus(runId, "cancelled")
    if (updated === undefined) throw new NotFoundError(`run ${runId} not found`)
    await this.syncProvider.push()
    return updated
  }

  // --- Executor-internal progress writes (field-level, decision #6b) ---

  /** Patch one node's status entry into the run — targeted column write, not whole-row. */
  appendNodeStatus(runId: string, nodeId: string, entry: JsonValue): void {
    this.runs.appendNodeStatus(runId, nodeId, entry)
  }

  /** Merge freshly extracted variables into the run — targeted column write. */
  setExtractedVariables(runId: string, variables: Record<string, JsonValue>): void {
    this.runs.mergeExtractedVariables(runId, variables)
  }

  /** Persist one completed node's evidence so it can be inspected before run completion. */
  // fallow-ignore-next-line code-duplication -- thin repository delegate, matches existing sibling methods
  upsertNodeResult(runId: string, result: RunResult): void {
    this.runs.upsertNodeResult(runId, result)
  }

  /** Transition the run to a terminal status (completed/failed/cancelled/interrupted). */
  completeRun(runId: string, status: Run["status"], error?: string): Run | undefined {
    return this.runs.updateStatus(runId, status, error)
  }

  /** Active broker-wait subscriptions — exposed for tests to assert no leak. */
  getActiveWaitCount(): number {
    return this.activeWaits
  }

  private activeWaits = 0

  private async enqueueRun(workspaceId: string, input: Omit<RunCreate, "workspaceId">): Promise<Run> {
    if (this.trigger !== undefined) {
      // The scheduler creates the run row (status pending→running) and starts
      // execution; re-read it to return the freshly-scheduled run.
      const runId = this.trigger.enqueue({
        workspaceId,
        workflowId: input.workflowId,
        ...(input.variables ? { variables: input.variables } : {}),
        ...(input.selectedEnvironmentId !== undefined ? { selectedEnvironmentId: input.selectedEnvironmentId } : {}),
      })
      return this.mustGet(workspaceId, runId)
    }
    return this.runs.create({ ...input, workspaceId })
  }

  /**
   * Retriable creation: the same `operationId` in the same workspace with the
   * same canonical request returns the first run instead of enqueueing again;
   * the same id with a changed request conflicts. Concurrent acceptance shares
   * one in-flight enqueue so two racing retries cannot both enqueue. Best
   * effort within this process lifetime — it does not promise exactly-once
   * remote HTTP side effects after a crash/restart.
   */
  private async createRunDeduped(
    workspaceId: string,
    input: Omit<RunCreate, "workspaceId">,
    operationId: string,
    waitMs: number,
    signal?: AbortSignal,
  ): Promise<Run> {
    const key = `${workspaceId}:${operationId}`
    const canonical = canonicalCreateRequest(input)
    const existing = this.createDedup.get(key)
    if (existing !== undefined) {
      // Workspace binding is the key's first component, so only the canonical
      // request has to be compared here.
      if (existing.canonical !== canonical) {
        throw new ConflictError("This operationId was already used with a different request; use a new operationId.", {
          operationId,
        })
      }
      // A replay whose run row is gone (deleted history) drops the entry and
      // falls through to a fresh enqueue: an idempotency key exists to make the
      // retry work, not to fail it with a not-found for a run nobody has.
      const run = this.runs.getById(existing.runId)
      if (run !== undefined && run.workspaceId === workspaceId) {
        if (waitMs === 0) return run
        return this.waitForRun(workspaceId, existing.runId, waitMs, signal !== undefined ? { signal } : {})
      }
      this.createDedup.delete(key)
    }
    const inflight = this.createInflight.get(key)
    if (inflight !== undefined) {
      const run = await inflight
      if (waitMs === 0) return this.mustGet(workspaceId, run.runId)
      return this.waitForRun(workspaceId, run.runId, waitMs, signal !== undefined ? { signal } : {})
    }
    const pending = (async (): Promise<Run> => {
      const run = await this.enqueueRun(workspaceId, input)
      this.createDedup.set(key, { canonical, runId: run.runId })
      if (this.createDedup.size > MAX_DEDUP_ENTRIES) {
        const oldest = this.createDedup.keys().next().value
        if (oldest !== undefined) this.createDedup.delete(oldest)
      }
      return run
    })()
    this.createInflight.set(key, pending)
    try {
      const run = await pending
      if (waitMs === 0) return run
      return this.waitForRun(workspaceId, run.runId, waitMs, signal !== undefined ? { signal } : {})
    } finally {
      this.createInflight.delete(key)
    }
  }

  private async waitByBroker(
    workspaceId: string,
    runId: string,
    waitMs: number,
    broker: RunEventBroker | RunEventSource,
    signal?: AbortSignal,
  ): Promise<Run> {
    // Subscribe BEFORE re-reading current state: a completion landing between
    // lookup and subscription would otherwise be missed and the wait would
    // hang until its deadline.
    let resolveTerminal: (() => void) | undefined
    const terminalPromise = new Promise<void>((resolve) => {
      resolveTerminal = resolve
    })
    this.activeWaits += 1
    const unsubscribe = broker.subscribe((event) => {
      if (event.runId === runId && event.kind === "run.finished") {
        resolveTerminal?.()
      }
    })
    try {
      const current = this.mustGet(workspaceId, runId)
      if (isTerminalStatus(current.status)) {
        return current
      }
      if (waitMs === 0) return current
      throwIfAborted(signal)
      await waitForTerminal(terminalPromise, waitMs, signal)
      // Re-authorize the final retrieval: the caller's access may have changed
      // while waiting, and the initial check must not grant a future read.
      await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_RUNS)
      return this.mustGet(workspaceId, runId)
    } finally {
      this.activeWaits -= 1
      unsubscribe()
    }
  }

  private async waitByPolling(
    workspaceId: string,
    runId: string,
    waitMs: number,
    signal?: AbortSignal,
  ): Promise<Run> {
    const current = this.mustGet(workspaceId, runId)
    if (isTerminalStatus(current.status) || waitMs === 0) return current
    throwIfAborted(signal)
    const deadline = Date.now() + waitMs
    for (;;) {
      throwIfAborted(signal)
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_RUNS)
        return this.mustGet(workspaceId, runId)
      }
      await sleep(Math.min(POLL_INTERVAL_MS, remaining), signal)
      const latest = this.mustGet(workspaceId, runId)
      if (isTerminalStatus(latest.status)) {
        await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_RUNS)
        return latest
      }
    }
  }

  private mustGet(workspaceId: string, runId: string): Run {
    const run = this.runs.getById(runId)
    if (run === undefined || run.workspaceId !== workspaceId) {
      throw new NotFoundError(`run ${runId} not found`)
    }
    return run
  }
}

const MAX_DEDUP_ENTRIES = 500
const POLL_INTERVAL_MS = 20

const TERMINAL_RUN_STATUSES: ReadonlySet<Run["status"]> = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
])

function isTerminalStatus(status: Run["status"]): boolean {
  return TERMINAL_RUN_STATUSES.has(status)
}

/** Read `aborted` through a helper so TypeScript does not narrow it away across awaits. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && (signal.aborted as boolean) === true
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (isAborted(signal)) throw abortError("wait cancelled")
}

export function normalizeWaitMs(waitMs: number | undefined): number {
  if (waitMs === undefined) return RUN_WAIT_DEFAULT_MS
  if (!Number.isFinite(waitMs)) return RUN_WAIT_DEFAULT_MS
  const floored = Math.floor(waitMs)
  if (floored <= 0) return 0
  return Math.min(floored, RUN_WAIT_MAX_MS)
}

/** Canonical request for idempotency: what actually affects the enqueued run. */
function canonicalCreateRequest(input: Omit<RunCreate, "workspaceId">): string {
  return JSON.stringify({
    workflowId: input.workflowId,
    status: input.status ?? "pending",
    trigger: input.trigger ?? "manual",
    variables: sortJsonValue(input.variables ?? {}),
    selectedEnvironmentId: input.selectedEnvironmentId ?? null,
    nodeStatuses: sortJsonValue(input.nodeStatuses ?? {}),
  })
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortJsonValue(record[key])
    }
    return sorted
  }
  return value
}

function waitForTerminal(
  terminalPromise: Promise<void>,
  waitMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  let onAbort: (() => void) | undefined
  const cleanup = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    if (signal !== undefined && onAbort !== undefined) {
      signal.removeEventListener("abort", onAbort)
    }
  }
  return new Promise<void>((resolve, reject) => {
    if (isAborted(signal)) {
      cleanup()
      reject(abortError("wait cancelled"))
      return
    }
    timer = setTimeout(() => {
      cleanup()
      resolve()
    }, waitMs)
    // Don't let a bounded wait keep the process alive on quit.
    timer.unref?.()
    void terminalPromise.then(() => {
      cleanup()
      resolve()
    })
    if (signal !== undefined) {
      onAbort = () => {
        cleanup()
        reject(abortError("wait cancelled"))
      }
      signal.addEventListener("abort", onAbort, { once: true })
    }
  })
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (isAborted(signal)) {
      reject(abortError("wait cancelled"))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    timer.unref?.()
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(abortError("wait cancelled"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}
