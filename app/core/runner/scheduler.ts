import type { ResolvedSecretInfo } from "@shared/types/ResolvedSecretInfo"
import type { RunEvent, RunTerminalStatus } from "@shared/types/RunProgressEvent"
import type { JsonValue } from "@shared/types/JsonValue"
import { withoutCanvasOnlyNodes } from "@shared/graph/frames"
import type { RunResult } from "@shared/types/RunResult"
import type { RunRepository } from "../repositories/RunRepository"
import type { WorkflowRepository } from "../repositories/WorkflowRepository"
import type { EnvironmentRepository } from "../repositories/EnvironmentRepository"
import type { ClockProvider, RngProvider } from "./harness/providers"
import { WorkflowExecutor, type WorkflowGraph, type ExecutorDeps, type ExecutorOutput, type ExecutorProgressEvent, type NodeResultEvent, type ResolvedSubWorkflow } from "./executor"
import { DynamicFunctions } from "./dynamic_functions"
import { HTTPS_DOWNGRADE_MESSAGE, NETWORK_ERROR_PREFIX, SafeHttp } from "./safe_http"
import { NotFoundError } from "../ipc/errors"
import { SECRET_PLACEHOLDER, sanitizeVariablesForExport } from "../services/secret_utils"
import { createSecretMasker } from "./secret_masker"

const DEFAULT_CONCURRENCY_CAP = 4

/**
 * The run error of an agent-started run the user did not allow to send
 * secrets. Fixed text — it is persisted and shown in History, and the MCP run
 * projection recognises it to report `deniedByUser` without exposing errors.
 */
export const AGENT_RUN_DENIED_ERROR =
  "Not run: an agent started this run and it was not allowed to send secrets"

/** What the user is asked before an agent-started run may use secrets. */
export interface AgentRunApprovalRequest {
  readonly runId: string
  /** The MCP client's own name for itself — self-reported, shown as such. */
  readonly agent: string
  readonly workflowName: string
  /** Secret names that resolved to a value and would be sent. */
  readonly secretNames: readonly string[]
  /**
   * Where the run's requests go: the host where a URL resolves statically
   * (literal, `{{env.*}}`, `{{variables.*}}`), the URL as written otherwise.
   */
  readonly destinations: readonly string[]
}

export interface SchedulerDeps {
  readonly runs: RunRepository
  readonly workflows: WorkflowRepository
  readonly environments?: EnvironmentRepository
  readonly http: SafeHttp
  readonly functions: DynamicFunctions
  readonly clock: ClockProvider
  readonly rng: RngProvider
  readonly emitProgress?: (runId: string, event: RunEvent) => void
  readonly concurrencyCap?: number
  /** Trusted runtime secret resolver — opens sealed boxes down the env > workspace
   * chain. Returns the plaintext plus which scope won (or null/null when unset),
   * so the run can record safe resolution metadata for masked-secret debugging. */
  readonly resolveSecret?: (
    name: string,
    chain: { environmentId?: string; workspaceId?: string },
  ) => Promise<{ plaintext: string | null; scopeType: "environment" | "workspace" | null }>
  /**
   * Ask the user, over a path no MCP client can reach, whether an
   * agent-started run may send the secrets it resolved. Resolves false on
   * deny, timeout or `signal` (the run was cancelled). Absent means no one can
   * be asked, so such a run is refused.
   */
  readonly approveAgentRun?: (request: AgentRunApprovalRequest, signal: AbortSignal) => Promise<boolean>
}

export interface EnqueueRequest {
  readonly workspaceId: string
  readonly workflowId: string
  readonly startNodeIds?: readonly string[]
  readonly variables?: Readonly<Record<string, unknown>>
  readonly selectedEnvironmentId?: string | null
  /** Set when an agent started the run over MCP: the client's name. */
  readonly agent?: string
}

/**
 * In-process async run scheduler. Ports Python `run_service.trigger_workflow_run`
 * + `worker.py` into a single-process queue with a concurrency cap.
 *
 * On startup, `reconcileOnStartup()` marks any runs left in `pending`/`running`
 * as `interrupted` (terminal) — never auto-resumes. Re-run is the user's choice.
 *
 * Cancellation: per-run `AbortController`; the executor checks between nodes.
 * Progress: the executor's `node.completed` events are proxied to the renderer
 * via the `emitProgress` dep AND written to the DB via `appendNodeStatus`
 * (field-level, decision #6b).
 */
export class RunScheduler {
  private readonly activeRuns = new Map<string, AbortController>()
  /** runId → agent name, for runs an agent started. In memory: a restart interrupts every run anyway. */
  private readonly agentRuns = new Map<string, string>()
  private readonly queue: string[] = []
  /** runId → callers of {@link whenFinished} still waiting on it. */
  private readonly finishWaiters = new Map<string, ((status: RunTerminalStatus) => void)[]>()
  private draining = false

  public constructor(private readonly deps: SchedulerDeps) {}

  public getActiveCount(): number {
    return this.activeRuns.size
  }

  public getQueueLength(): number {
    return this.queue.length
  }

  public enqueue(request: EnqueueRequest): string {
    // Object-level ownership check: the workflow must live in the run's workspace.
    // RunService authorizes the workspaceId but passes workflowId through untouched,
    // so without this a caller could execute another workspace's graph under their
    // run. Existence-hiding 404 mirrors WorkflowService's scoped reads.
    const workflow = this.deps.workflows.getByIdInWorkspace(request.workflowId, request.workspaceId)
    if (!workflow) {
      throw new NotFoundError(`workflow ${request.workflowId} not found`)
    }
    // Inherit the workflow's stored `selectedEnvironmentId` when the caller
    // omits it (an MCP agent running a workflow without a UI dropdown, or the
    // canvas's Run button before the environment picker has a value). Without
    // this, `runs_create` echoes `selectedEnvironmentId: null` even when the
    // workflow has one set, the run row stays null, and any `{{env.*}}`
    // placeholder goes out as literal text — a 401 from the target that is
    // indistinguishable from wrong credentials. `undefined` means "use the
    // workflow's default"; an explicit `null` means "run with no environment".
    // The execute-time fallback (`run.selectedEnvironmentId ?? workflow.selectedEnvironmentId`)
    // is kept as defense-in-depth, but the run row now reflects what will
    // actually run, so the echo and the run agree.
    const inheritedEnvironmentId =
      request.selectedEnvironmentId === undefined
        ? workflow.selectedEnvironmentId ?? null
        : request.selectedEnvironmentId
    const run = this.deps.runs.create({
      workspaceId: request.workspaceId,
      workflowId: request.workflowId,
      status: "pending",
      ...(request.variables ? { variables: request.variables as Record<string, JsonValue> } : {}),
      selectedEnvironmentId: inheritedEnvironmentId,
    })
    if (request.agent !== undefined) this.agentRuns.set(run.runId, request.agent)
    this.queue.push(run.runId)
    void this.drain()
    return run.runId
  }

  public cancel(runId: string): boolean {
    const controller = this.activeRuns.get(runId)
    if (controller) {
      controller.abort()
      return true
    }
    const idx = this.queue.indexOf(runId)
    if (idx >= 0) {
      this.queue.splice(idx, 1)
      this.deps.runs.updateStatus(runId, "cancelled")
      // A queued run never reached executeRun, so nothing else will publish its
      // terminal event — do it here or a subscriber waits forever (Phase 6).
      this.emitFinished(runId, "cancelled")
      return true
    }
    return false
  }

  /**
   * Resolves with the run's terminal status once it has one — at once for a
   * run that already finished, which a run can do inside `enqueue` when it
   * fails before its first await. Rejects for a run that does not exist.
   */
  public whenFinished(runId: string): Promise<RunTerminalStatus> {
    const run = this.deps.runs.getById(runId)
    if (run === undefined) return Promise.reject(new NotFoundError(`run ${runId} not found`))
    if (run.status !== "pending" && run.status !== "running") return Promise.resolve(run.status)
    return new Promise((resolve) => {
      const waiters = this.finishWaiters.get(runId) ?? []
      waiters.push(resolve)
      this.finishWaiters.set(runId, waiters)
    })
  }

  public reconcileOnStartup(): number {
    const nonTerminal = this.deps.runs.listNonTerminal()
    for (const run of nonTerminal) {
      this.deps.runs.updateStatus(run.runId, "interrupted")
    }
    return nonTerminal.length
  }

  public async shutdown(graceMs = 2000): Promise<void> {
    for (const controller of this.activeRuns.values()) {
      controller.abort()
    }
    const deadline = Date.now() + graceMs
    while (this.activeRuns.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    for (const runId of this.activeRuns.keys()) {
      this.deps.runs.updateStatus(runId, "interrupted")
      // The abort above may not have driven executeRun's catch to a terminal
      // publish before the grace window closed — publish once here (the broker
      // dedups a later duplicate terminal).
      this.emitFinished(runId, "interrupted")
    }
    // Runs still queued never started; mark and publish a terminal so any
    // subscriber unwinds rather than hanging on a run that will never run.
    for (const runId of this.queue) {
      this.deps.runs.updateStatus(runId, "interrupted")
      this.emitFinished(runId, "interrupted")
    }
    this.queue.length = 0
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      const cap = this.deps.concurrencyCap ?? DEFAULT_CONCURRENCY_CAP
      while (this.queue.length > 0 && this.activeRuns.size < cap) {
        const runId = this.queue.shift()!
        void this.executeRun(runId)
      }
    } finally {
      this.draining = false
    }
  }

  private async executeRun(runId: string): Promise<void> {
    const controller = new AbortController()
    this.activeRuns.set(runId, controller)
    this.deps.runs.updateStatus(runId, "running")
    this.deps.emitProgress?.(runId, { kind: "run.started", runId })

    try {
      const run = this.deps.runs.getById(runId)
      if (!run) throw new Error(`run ${runId} not found after create`)

      // Defense-in-depth: re-assert workflow ownership at execution time (enqueue
      // already checked), so a run row can never execute a graph outside its workspace.
      const workflow = this.deps.workflows.getByIdInWorkspace(run.workflowId, run.workspaceId)
      if (!workflow) throw new Error(`workflow ${run.workflowId} not found`)

      const mergedVariables = { ...workflow.variables, ...(run.variables ?? {}) }
      const graph: WorkflowGraph = {
        // Canvas-only nodes are furniture with no edges. Left in, the executor
        // answers them with `{ status: "skipped" }` — a row in the run timeline
        // and the JUnit report for something that was never a step.
        nodes: withoutCanvasOnlyNodes(workflow.nodes) as unknown as WorkflowGraph["nodes"],
        edges: workflow.edges as unknown as WorkflowGraph["edges"],
        ...(Object.keys(mergedVariables).length > 0 ? { variables: mergedVariables as Record<string, unknown> } : {}),
      }

      const selectedEnvironmentId = run.selectedEnvironmentId ?? workflow.selectedEnvironmentId ?? null
      const environments = this.deps.environments
      const environment = selectedEnvironmentId ? environments?.getById(selectedEnvironmentId) : undefined
      if (selectedEnvironmentId && (environment === undefined || environment.workspaceId !== run.workspaceId)) {
        throw new Error(`environment ${selectedEnvironmentId} not found for run ${runId}`)
      }

      // Every workflow the run can reach, read once, now: the secrets scan, the
      // agent approval and the Call Workflow nodes all see the same graphs, so
      // an edit made while the run waits for approval or runs cannot change
      // where an approved secret goes.
      const reachable = this.reachableWorkflows(workflow.workflowId, workflow, run.workspaceId)
      const secretResolution = await this.resolveRunSecrets(reachable.nodes, selectedEnvironmentId, run.workspaceId)
      if (secretResolution.resolvedSecrets.length > 0) {
        void this.deps.runs.setResolvedSecrets(runId, secretResolution.resolvedSecrets)
      }
      const environmentVariables = environment && environments
        ? environments.resolveEffectiveVariables(environment.environmentId) as Record<string, unknown>
        : undefined

      // H10: a local agent can author a workflow and run it, so without this
      // it could send any stored secret to a host of its choosing. A run it
      // started may use secrets only once the user has seen which ones and
      // where they go. Runs without secrets proceed as before.
      // ponytail: the waiting run holds its concurrency slot until answered or timed out.
      const agent = this.agentRuns.get(runId)
      const secretNames = Object.keys(secretResolution.secrets ?? {})
      if (agent !== undefined && secretNames.length > 0) {
        const approved = await this.askApproval(
          {
            runId,
            agent,
            workflowName: workflow.name,
            secretNames,
            destinations: requestDestinations(reachable.nodes, environmentVariables ?? {}, mergedVariables),
          },
          controller.signal,
        )
        if (!approved) {
          if (controller.signal.aborted) throw new Error("cancelled")
          throw new AgentRunDenied()
        }
      }
      // Every value this run resolved is scrubbed from whatever leaves the
      // executor — persisted results, node snapshots, progress events — for the
      // run and its Call Workflow sub-runs alike. The executor keeps the real
      // values; only the stored/emitted copy is masked.
      const mask = createSecretMasker(Object.values(secretResolution.secrets ?? {}))

      const executorDeps: ExecutorDeps = {
        clock: this.deps.clock,
        rng: this.deps.rng,
        http: this.deps.http,
        functions: this.deps.functions,
        ...(environmentVariables ? { environmentVariables } : {}),
        ...(secretResolution.secrets ? { secrets: secretResolution.secrets } : {}),
        emitProgress: (event) => this.handleProgress(runId, mask(event)),
        resolveWorkflow: (workflowId): ResolvedSubWorkflow | undefined => reachable.workflows.get(workflowId),
        // A Call Workflow node's sub-execution is a run of the *target*
        // workflow, so it gets its own row in that workflow's history (same
        // workspace and environment as the caller). Not queued through
        // `enqueue`: it is already executing inside the caller's slot and must
        // not wait behind the concurrency cap the caller is occupying.
        subRun: {
          begin: (workflowId) => {
            const child = this.deps.runs.create({
              workspaceId: run.workspaceId,
              workflowId,
              selectedEnvironmentId,
            })
            this.deps.runs.updateStatus(child.runId, "running")
            return {
              runId: child.runId,
              // Spreading `executorDeps` carries `subRun` itself down, so a
              // sub-workflow that calls a sub-workflow is recorded too.
              deps: { ...executorDeps, emitProgress: (event) => this.handleProgress(child.runId, mask(event)) },
            }
          },
          finish: (childRunId, childOutput) => {
            if (childOutput) this.recordOutcome(childRunId, mask(childOutput))
            else if (controller.signal.aborted) this.deps.runs.updateStatus(childRunId, "cancelled")
            else this.deps.runs.updateStatus(childRunId, "failed", "Workflow execution failed")
          },
        },
      }

      const executor = new WorkflowExecutor(executorDeps)
      const output = await executor.executeWorkflow(graph, {
        runId,
        cancelSignal: controller.signal,
        ...(run.resumeFromNodeIds ? { startNodeIds: run.resumeFromNodeIds } : {}),
      })

      this.emitFinished(runId, this.recordOutcome(runId, mask(output)))
    } catch (error) {
      if (controller.signal.aborted) {
        this.deps.runs.updateStatus(runId, "cancelled")
        this.emitFinished(runId, "cancelled")
      } else if (error instanceof AgentRunDenied) {
        this.deps.runs.updateStatus(runId, "failed", AGENT_RUN_DENIED_ERROR)
        this.emitFinished(runId, "failed")
      } else {
        const existing = this.deps.runs.getById(runId)
        if (existing) {
          this.deps.runs.updateExecutionEvidence(runId, {
            results: existing.results,
            extractedVariables: sanitizeVariablesForExport(existing.variables),
            failedNodes: existing.failedNodes ?? [],
            failureMessage: "Workflow execution failed",
          })
        }
        this.deps.runs.updateStatus(runId, "failed", "Workflow execution failed")
        this.emitFinished(runId, "failed")
      }
    } finally {
      this.activeRuns.delete(runId)
      this.agentRuns.delete(runId)
      void this.drain()
    }
  }

  /**
   * Persist an executor output as a run's terminal evidence + status. Shared by
   * top-level runs and Call Workflow sub-runs. `output` must already be masked.
   */
  private recordOutcome(runId: string, output: ExecutorOutput): RunTerminalStatus {
    const failureMessage = safeFailureMessage(output.failedNodes)
    this.deps.runs.updateExecutionEvidence(runId, {
      results: sanitizeRunResults(output.results),
      extractedVariables: sanitizeFinalVariables(output),
      failedNodes: output.failedNodes,
      failureMessage,
    })
    if (output.status !== "failed") {
      const status = output.status === "passed" ? "completed" : "cancelled"
      this.deps.runs.updateStatus(runId, status)
      return status
    }
    this.deps.runs.updateStatus(runId, "failed", failureMessage ?? "Workflow execution failed")
    return "failed"
  }

  private emitFinished(runId: string, status: RunTerminalStatus): void {
    this.deps.emitProgress?.(runId, { kind: "run.finished", runId, status })
    const waiters = this.finishWaiters.get(runId)
    this.finishWaiters.delete(runId)
    for (const resolve of waiters ?? []) resolve(status)
  }

  /** A missing approver means no one can be asked, which is a no. A throwing one is too. */
  private async askApproval(request: AgentRunApprovalRequest, signal: AbortSignal): Promise<boolean> {
    if (this.deps.approveAgentRun === undefined) return false
    try {
      return await this.deps.approveAgentRun(request, signal)
    } catch {
      return false
    }
  }

  /**
   * The run's workflow and every workflow its Call Workflow nodes reach, read
   * once. A sub-execution shares this run's secret map, so the secrets scan
   * must see all of them — and the executor is then served these same
   * snapshots rather than re-reading the database mid-run.
   */
  private reachableWorkflows(
    workflowId: string,
    root: { readonly name: string; readonly nodes: readonly unknown[]; readonly edges: readonly unknown[]; readonly variables: Readonly<Record<string, unknown>> },
    workspaceId: string,
  ): { nodes: WorkflowGraph["nodes"]; workflows: Map<string, ResolvedSubWorkflow> } {
    const snapshot = (target: typeof root): ResolvedSubWorkflow => ({
      name: target.name,
      nodes: withoutCanvasOnlyNodes(target.nodes as WorkflowGraph["nodes"]) as unknown as WorkflowGraph["nodes"],
      edges: target.edges as unknown as WorkflowGraph["edges"],
      variables: target.variables as Record<string, unknown>,
    })
    const workflows = new Map<string, ResolvedSubWorkflow>([[workflowId, snapshot(root)]])
    const nodes: WorkflowGraph["nodes"][number][] = []
    const pending = [workflows.get(workflowId)!.nodes]
    for (let batch = pending.pop(); batch; batch = pending.pop()) {
      for (const node of batch) {
        nodes.push(node)
        // Same lookup the executor's `resolveWorkflow` does, so a target it
        // could not reach contributes nothing here either.
        const target = node.type === "workflow" ? node.config?.["targetWorkflowId"] : undefined
        if (typeof target !== "string" || workflows.has(target)) continue
        const child = this.deps.workflows.getByIdInWorkspace(target, workspaceId)
        if (!child) continue
        const resolved = snapshot(child)
        workflows.set(target, resolved)
        pending.push(resolved.nodes)
      }
    }
    return { nodes, workflows }
  }

  /**
   * Resolve every `{{secrets.NAME}}` referenced by `nodes` down the env >
   * workspace chain, and return a name -> plaintext map for the executor plus
   * safe resolution metadata (name/scope/resolved) for masked-secret
   * debugging — never values. Returns nothing when no resolver is wired or no
   * references exist.
   */
  private async resolveRunSecrets(
    nodes: WorkflowGraph["nodes"],
    environmentId: string | null,
    workspaceId: string,
  ): Promise<{ secrets?: Record<string, string>; resolvedSecrets: ResolvedSecretInfo[] }> {
    const resolver = this.deps.resolveSecret
    if (!resolver) return { resolvedSecrets: [] }

    const names = new Set<string>()
    const pattern = /\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g
    for (const node of nodes) {
      for (const value of collectStrings(node.config)) {
        for (const m of value.matchAll(pattern)) names.add(m[1]!)
      }
    }
    if (names.size === 0) return { resolvedSecrets: [] }

    const chain = { ...(environmentId ? { environmentId } : {}), workspaceId }
    const secrets: Record<string, string> = {}
    const resolvedSecrets: ResolvedSecretInfo[] = []
    for (const name of names) {
      const { plaintext, scopeType } = await resolver(name, chain)
      resolvedSecrets.push({ name, scopeType, resolved: plaintext !== null })
      if (plaintext !== null) secrets[name] = plaintext
    }
    return { ...(Object.keys(secrets).length > 0 ? { secrets } : {}), resolvedSecrets }
  }

  /** `event` must already be masked: it goes straight to run history and to subscribers. */
  private handleProgress(runId: string, event: ExecutorProgressEvent): void {
    if (event.kind === "node.result") {
      this.handleNodeResult(runId, event)
      return
    }
    // The executor only ever hands us node events; started/terminal events are
    // emitted separately. Narrow so appendNodeStatus stays node-only.
    if (event.kind !== "node.status") return
    // A workflow can extract a token/password/api-key into a variable; redact
    // secret-looking keys/values the same way exports do before this snapshot
    // goes out over IPC and into run history (readable via runs.get/list, incl. MCP).
    const sanitizedVariables = sanitizeVariablesForExport(event.variables as Record<string, JsonValue>)
    const sanitizedError = event.error ? safeErrorClass(event.error) : undefined
    const sanitizedEvent: RunEvent = {
      ...event,
      variables: sanitizedVariables,
      ...(sanitizedError ? { error: sanitizedError } : {}),
    }
    this.deps.emitProgress?.(runId, sanitizedEvent)
    this.deps.runs.appendNodeStatus(runId, event.nodeId, {
      status: event.status,
      variables: sanitizedVariables,
      ...(sanitizedError ? { error: sanitizedError } : {}),
      ...(event.message ? { message: event.message } : {}),
      ...(event.statusCode !== undefined ? { statusCode: event.statusCode } : {}),
    })
  }

  // Persist the completed node immediately so runs_getNodeResult is useful
  // while independent branches are still running. This event deliberately
  // never reaches the progress broker because it can carry request/response
  // bodies; MCP and renderer subscribers only receive the safe status event.
  private handleNodeResult(runId: string, event: NodeResultEvent): void {
    const result = sanitizeRunResults([event.result])[0]
    if (result !== undefined) this.deps.runs.upsertNodeResult(runId, result)
  }
}

/** An agent-started run the user did not allow to send its secrets. */
class AgentRunDenied extends Error {}

/**
 * Where a run's requests go, for the approval prompt: every node's `url`,
 * with `{{env.*}}` and `{{variables.*}}` filled in where they are known before
 * the run, reduced to its host when it then parses. A URL built from values
 * the run itself produces stays as written — the user sees that it is not
 * fixed rather than a guess.
 */
export function requestDestinations(
  nodes: WorkflowGraph["nodes"],
  environmentVariables: Readonly<Record<string, unknown>>,
  variables: Readonly<Record<string, unknown>>,
): string[] {
  const scopes: Record<string, Readonly<Record<string, unknown>>> = { env: environmentVariables, variables }
  const destinations = new Set<string>()
  for (const node of nodes) {
    const url = node.config?.["url"]
    if (typeof url !== "string" || url.length === 0) continue
    const filled = url.replace(/\{\{\s*(env|variables)\.([A-Za-z0-9_.-]+)\s*\}\}/g, (match, scope: string, key: string) => {
      const value = key.split(".").reduce<unknown>(
        (current, part) => (typeof current === "object" && current !== null ? (current as Record<string, unknown>)[part] : undefined),
        scopes[scope],
      )
      return typeof value === "string" || typeof value === "number" ? String(value) : match
    })
    try {
      destinations.add(new URL(filled).host || filled)
    } catch {
      destinations.add(filled)
    }
  }
  return [...destinations]
}

function sanitizeFinalVariables(output: Awaited<ReturnType<WorkflowExecutor["executeWorkflow"]>>): Record<string, JsonValue> {
  // Redact secret-looking keys/values only (same posture as the failure path and
  // per-node snapshots). Real extracted values are kept for the trusted local run
  // history — the MCP run projection never exposes variables, so there is nothing
  // to mask them from over the wire.
  return sanitizeVariablesForExport(output.extractedVariables as Record<string, JsonValue>)
}

function safeFailureMessage(failedNodes: readonly string[]): string | null {
  if (failedNodes.length === 0) return null
  return failedNodes.length === 1
    ? "Workflow execution failed in 1 node"
    : `Workflow execution failed in ${failedNodes.length} nodes`
}

function sanitizeRunResults(results: readonly RunResult[]): RunResult[] {
  return results.map((result) => ({
    ...result,
    request: sanitizeRequestMetadata(result.request),
    ...(typeof result.error === "string" ? { error: safeErrorClass(result.error) } : {}),
    ...(result.attempts
      ? { attempts: result.attempts.map((attempt) => (attempt.error === undefined ? attempt : { ...attempt, error: safeErrorClass(attempt.error) })) }
      : {}),
  }))
}

function sanitizeRequestMetadata(request: JsonValue | undefined): JsonValue {
  if (request === null || typeof request !== "object" || Array.isArray(request)) return request ?? null
  const url = request["url"]
  if (typeof url !== "string") return request
  try {
    const parsed = new URL(url)
    // The URL parser percent-encodes a masked path segment; keep it legible.
    const pathname = parsed.pathname.replaceAll(encodeURIComponent(SECRET_PLACEHOLDER), SECRET_PLACEHOLDER)
    const safeUrl = `${parsed.protocol}//${parsed.host}${pathname}${parsed.search ? "?<REDACTED>" : ""}`
    return { ...request, url: safeUrl }
  } catch {
    return { ...request, url: "<URL>" }
  }
}

const CALL_WORKFLOW_ERRORS: readonly RegExp[] = [
  /^Called workflow [\w-]+ not found$/,
  /^Call Workflow node has no target workflow configured$/,
  /^Call Workflow recursion depth exceeded$/,
]

const RETRY_VERDICT = /^((?:Condition not met|Failed) after \d+ attempts)(?:: ([\s\S]*))?$/

function safeErrorClass(error: string): string {
  // A retrying node's verdict carries only its attempt count; its cause is classed on its own.
  const retry = RETRY_VERDICT.exec(error)
  if (retry) return retry[2] === undefined ? retry[1]! : `${retry[1]}: ${safeErrorClass(retry[2])}`
  // The status a retry gave up on.
  if (/^HTTP \d{3}$/.test(error)) return error
  // The runner's own network diagnosis names only the host, the system error
  // and its code; resolved secret values are masked before this point.
  if (error.startsWith(NETWORK_ERROR_PREFIX)) return error
  if (error.startsWith(HTTPS_DOWNGRADE_MESSAGE)) return HTTPS_DOWNGRADE_MESSAGE
  // The executor's own Call Workflow diagnoses carry at most the target's id.
  if (CALL_WORKFLOW_ERRORS.some((pattern) => pattern.test(error))) return error
  const normalized = error.toLowerCase()
  if (normalized.includes("redirect")) return "Redirect not followed"
  if (normalized.includes("cancelled")) return "Cancelled"
  // The executor's own timeout message carries no input, only the node's deadline.
  if (/^Request timed out after \d+(\.\d+)?s$/.test(error)) return error
  if (normalized.includes("timeout") || normalized.includes("timed out") || normalized.includes("aborted")) {
    return "Request timed out"
  }
  if (
    normalized.includes("url is required") ||
    normalized.includes("failed to build request") ||
    normalized.includes("not a requestable")
  ) {
    return "Request configuration invalid"
  }
  return "Node execution failed"
}

/** Recursively collect every string value within a node config (mirrors Python _iter_config_values). */
function collectStrings(obj: unknown): string[] {
  if (typeof obj === "string") return [obj]
  if (Array.isArray(obj)) return obj.flatMap(collectStrings)
  if (obj !== null && typeof obj === "object") {
    return Object.values(obj).flatMap(collectStrings)
  }
  return []
}
