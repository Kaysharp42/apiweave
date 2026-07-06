import type { ClockProvider, RngProvider } from "./harness/providers"
import type { RequestInit as UndiciRequestInit } from "undici"
import { DynamicFunctions } from "./dynamic_functions"
import { SafeHttp, SafeUrlError } from "./safe_http"
import type { RunProgressEvent } from "../../../shared/types/RunProgressEvent"
import type { RunnerNodeStatus } from "../../../shared/types/RunnerNodeStatus"

/**
 * Workflow executor — ported from `backend/app/runner/executor.py`.
 *
 * Processes workflow nodes in graph order, resolves templates, executes HTTP requests,
 * evaluates assertions, handles delays and merge nodes, and writes field-level updates.
 * Emits `node.completed` events for the renderer (decision #6, (c)).
 */

// -------------------- Types --------------------

export interface WorkflowNode {
  readonly nodeId: string
  readonly type: "http-request" | "assertion" | "delay" | "merge" | "start" | "end"
  readonly label?: string | null
  readonly config?: Record<string, unknown>
}

export interface WorkflowEdge {
  readonly edgeId: string
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
}

export interface WorkflowGraph {
  readonly nodes: readonly WorkflowNode[]
  readonly edges: readonly WorkflowEdge[]
  readonly variables?: Readonly<Record<string, unknown>>
  readonly settings?: { readonly continueOnFail?: boolean }
}

export interface ExecutorDeps {
  readonly clock: ClockProvider
  readonly rng: RngProvider
  readonly http: SafeHttp
  readonly functions: DynamicFunctions
  readonly baseUrl?: string
  readonly secrets?: Readonly<Record<string, string>>
  readonly emitProgress?: (event: RunProgressEvent) => void
}

export interface ExecuteOptions {
  readonly runId?: string
  readonly startNodeIds?: readonly string[]
  readonly cancelSignal?: AbortSignal
}

export interface NodeResult {
  readonly status: string
  readonly statusCode?: number
  readonly body?: unknown
  readonly headers?: Record<string, string>
  readonly duration?: number
  readonly error?: string
  readonly assertionOutcome?: "pass" | "fail"
  readonly message?: string
  readonly type?: string
  readonly response?: {
    readonly body: unknown
    readonly headers: Record<string, string>
    readonly statusCode: number
  }
  readonly mergedByOther?: boolean
  readonly [key: string]: unknown
}

export interface ExecutorOutput {
  readonly caseName?: string
  readonly status: "passed" | "failed"
  readonly startedAt: string
  readonly seed?: string
  readonly nodeStatuses: Readonly<Record<string, RunnerNodeStatus>>
  readonly extractedVariables: Readonly<Record<string, unknown>>
  readonly outputs: Readonly<Record<string, unknown>>
}

// -------------------- Internal sentinel --------------------

class StopBranch extends Error {
  public constructor(message: string) {
    super(message)
    this.name = "StopBranch"
  }
}

// -------------------- Executor --------------------

export class WorkflowExecutor {
  private readonly results = new Map<string, NodeResult>()
  private readonly workflowVariables: Record<string, unknown> = {}
  private readonly environmentVariables: Record<string, string> = {}
  private readonly nodeStatuses = new Map<string, RunnerNodeStatus>()
  private readonly failedNodes = new Set<string>()
  private hasFailures = false
  private firstErrorMessage: string | null = null
  private readonly branchResults = new Map<string, ReadonlyArray<readonly [string, NodeResult]>>()
  private currentBranchContext: ReadonlyArray<readonly [string, NodeResult]> = []
  private readonly mergeCompleted = new Set<string>()

  public constructor(private readonly deps: ExecutorDeps) {}

  public async executeWorkflow(
    workflow: WorkflowGraph,
    options: ExecuteOptions = {},
    caseName?: string,
    seed?: string,
  ): Promise<ExecutorOutput> {
    const startedAt = this.deps.clock.isoNow()

    if (workflow.variables) {
      for (const [key, value] of Object.entries(workflow.variables)) {
        this.workflowVariables[key] = value
      }
    }

    const continueOnFail = workflow.settings?.continueOnFail ?? false
    this.hasFailures = false
    this.firstErrorMessage = null

    const nodes = new Map<string, WorkflowNode>()
    for (const node of workflow.nodes) {
      nodes.set(node.nodeId, node)
    }
    const edges = workflow.edges

    let entryNodeIds: string[] = []
    if (options.startNodeIds && options.startNodeIds.length > 0) {
      entryNodeIds = options.startNodeIds.filter((id) => nodes.has(id))
    }
    if (entryNodeIds.length === 0) {
      const startNode = workflow.nodes.find((n) => n.type === "start")
      if (!startNode) {
        return this.buildOutput(caseName, startedAt, seed, "failed")
      }
      entryNodeIds = [startNode.nodeId]
    }

    if (options.cancelSignal?.aborted) {
      return this.buildOutput(caseName, startedAt, seed, "failed")
    }

    try {
      if (entryNodeIds.length === 1) {
        await this.executeFromNode(entryNodeIds[0]!, nodes, edges, options.cancelSignal, continueOnFail)
      } else {
        const tasks = entryNodeIds.map((id) =>
          this.executeFromNode(id, nodes, edges, options.cancelSignal, continueOnFail),
        )
        const settled = await Promise.allSettled(tasks)
        for (const result of settled) {
          if (result.status === "rejected" && !(result.reason instanceof StopBranch)) {
            this.hasFailures = true
            if (!this.firstErrorMessage) {
              this.firstErrorMessage = String(result.reason)
            }
            if (!continueOnFail) {
              throw result.reason
            }
          }
        }
      }

      const finalStatus: "passed" | "failed" = this.hasFailures ? "failed" : "passed"
      return this.buildOutput(caseName, startedAt, seed, finalStatus)
    } catch (error) {
      if (error instanceof StopBranch) {
        return this.buildOutput(caseName, startedAt, seed, "failed")
      }
      throw error
    }
  }

  // -------------------- Node execution --------------------

  private async executeFromNode(
    nodeId: string,
    nodes: Map<string, WorkflowNode>,
    edges: readonly WorkflowEdge[],
    cancelSignal: AbortSignal | undefined,
    continueOnFail: boolean,
  ): Promise<void> {
    const node = nodes.get(nodeId)
    if (!node) return
    if (cancelSignal?.aborted) return

    // Set branch context if predecessor is a merge
    const incomingEdges = edges.filter((e) => e.target === nodeId)
    if (incomingEdges.length > 0) {
      for (const edge of incomingEdges) {
        const predId = edge.source
        const predBranches = this.branchResults.get(predId)
        if (predBranches) {
          const nextEdgesFromNode = edges.filter((e) => e.source === nodeId)
          if (nextEdgesFromNode.length > 1) {
            this.currentBranchContext = predBranches
          } else {
            this.currentBranchContext = []
          }
          break
        }
      }
    }

    // Execute node (skip start)
    if (node.type !== "start") {
      try {
        const nodeExecResult = await this.executeNode(node, edges, cancelSignal, continueOnFail)
        if (nodeExecResult !== null && nodeExecResult.shouldContinue === false) {
          return
        }
      } catch (error) {
        if (error instanceof StopBranch) throw error
        this.hasFailures = true
        this.failedNodes.add(nodeId)
        if (!this.firstErrorMessage) {
          this.firstErrorMessage = String(error)
        }
        if (!continueOnFail) throw error
      }
    } else {
      this.updateNodeStatus(nodeId, "passed")
    }

    // Find next nodes
    let nextEdges = edges.filter((e) => e.source === nodeId)
    if (nextEdges.length === 0) return

    // Assertion routing
    if (node.type === "assertion" && this.results.has(nodeId)) {
      const assertionResult = this.results.get(nodeId)!
      const outcome = assertionResult.assertionOutcome ?? "pass"

      const handleEdges = nextEdges.filter((e) => e.sourceHandle === "pass" || e.sourceHandle === "fail")
      const legacyEdges = nextEdges.filter((e) => !e.sourceHandle)

      if (handleEdges.length > 0) {
        const matching = handleEdges.filter((e) => e.sourceHandle === outcome)
        if (matching.length > 0) {
          nextEdges = matching
        } else {
          if (outcome === "fail") {
            this.hasFailures = true
            this.failedNodes.add(nodeId)
          }
          return
        }
      } else if (legacyEdges.length > 0) {
        if (outcome === "fail") {
          this.hasFailures = true
          this.failedNodes.add(nodeId)
          if (!continueOnFail) {
            const errorMsg = assertionResult.message ?? "Assertion failed"
            throw new Error(errorMsg)
          }
        }
        nextEdges = legacyEdges
      }
    }

    // Branching
    if (nextEdges.length > 1) {
      if (node.type !== "merge") {
        this.currentBranchContext = []
      }

      const tasks: Promise<void>[] = []
      for (const edge of nextEdges) {
        const nextNodeId = edge.target
        const nextNode = nodes.get(nextNodeId)
        if (nextNode) {
          if (nextNode.type === "end") {
            this.updateNodeStatus(nextNodeId, "passed")
          } else {
            tasks.push(this.executeBranch(nextNodeId, nodes, edges, cancelSignal, continueOnFail))
          }
        }
      }

      if (tasks.length > 0) {
        const settled = await Promise.allSettled(tasks)
        const failedCount = settled.filter(
          (r) => r.status === "rejected" && !(r.reason instanceof StopBranch),
        ).length

        if (failedCount > 0) {
          for (let i = 0; i < settled.length; i++) {
            const r = settled[i]!
            if (r.status === "rejected" && !(r.reason instanceof StopBranch)) {
              const branchNodeId = nextEdges[i]!.target
              this.hasFailures = true
              this.failedNodes.add(branchNodeId)
              if (!this.firstErrorMessage) {
                this.firstErrorMessage = String(r.reason)
              }
            }
          }
        }

        if (failedCount > 0 && failedCount === tasks.length && !continueOnFail) {
          throw new Error(`All ${tasks.length} branches failed`)
        }
      }
    } else {
      const edge = nextEdges[0]!
      const nextNodeId = edge.target
      const nextNode = nodes.get(nextNodeId)
      if (nextNode) {
        if (nextNode.type === "end") {
          this.updateNodeStatus(nextNodeId, "passed")
        } else {
          try {
            await this.executeFromNode(nextNodeId, nodes, edges, cancelSignal, continueOnFail)
          } catch (error) {
            if (error instanceof StopBranch) throw error
            this.hasFailures = true
            this.failedNodes.add(nextNodeId)
            if (!this.firstErrorMessage) {
              this.firstErrorMessage = String(error)
            }
            if (!continueOnFail) throw error
          }
        }
      }
    }
  }

  private async executeBranch(
    nodeId: string,
    nodes: Map<string, WorkflowNode>,
    edges: readonly WorkflowEdge[],
    cancelSignal: AbortSignal | undefined,
    continueOnFail: boolean,
  ): Promise<void> {
    await this.executeFromNode(nodeId, nodes, edges, cancelSignal, continueOnFail)
  }

  private async executeNode(
    node: WorkflowNode,
    edges: readonly WorkflowEdge[],
    cancelSignal: AbortSignal | undefined,
    continueOnFail: boolean,
  ): Promise<{ shouldContinue: boolean } | null> {
    const nodeId = node.nodeId
    const nodeType = node.type

    this.updateNodeStatus(nodeId, "running")

    try {
      let result: NodeResult

      if (nodeType === "http-request") {
        result = await this.executeHttpRequest(node)
      } else if (nodeType === "delay") {
        result = await this.executeDelay(node, cancelSignal)
      } else if (nodeType === "assertion") {
        result = await this.executeAssertion(node)
      } else if (nodeType === "merge") {
        result = await this.executeMerge(node, edges)
      } else {
        result = { status: "skipped", message: `Unknown node type: ${nodeType}` }
      }

      // Determine execution status
      let executionStatus = result.status ?? "success"
      if (executionStatus === "client_error" || executionStatus === "server_error" || executionStatus === "error") {
        executionStatus = "error"
        this.hasFailures = true
        this.failedNodes.add(nodeId)
      } else if (executionStatus === "redirect") {
        executionStatus = "warning"
      } else if (executionStatus === "failed" && nodeType === "assertion") {
        executionStatus = "error"
      }

      // Check if merge was completed by another branch
      if (result.mergedByOther) {
        return { shouldContinue: false }
      }

      // Update node status
      const mappedStatus: RunnerNodeStatus = executionStatus === "success" || executionStatus === "warning" ? "passed" : "failed"
      this.updateNodeStatus(nodeId, mappedStatus, result)
      result = { ...result, type: nodeType }
      this.results.set(nodeId, result)

      // Handle failures
      if (executionStatus === "error" && nodeType !== "assertion" && !continueOnFail) {
        const errorMsg = (result.error as string | undefined) ?? `Node ${nodeId} failed`
        this.hasFailures = true
        this.failedNodes.add(nodeId)
        throw new StopBranch(errorMsg)
      }

      return { shouldContinue: true }
    } catch (error) {
      if (error instanceof StopBranch) throw error
      const errorResult: NodeResult = { status: "error", error: String(error) }
      this.updateNodeStatus(nodeId, "failed", errorResult)
      this.results.set(nodeId, errorResult)
      this.failedNodes.add(nodeId)
      throw error
    }
  }

  // -------------------- HTTP request --------------------

  private async executeHttpRequest(node: WorkflowNode): Promise<NodeResult> {
    const config = node.config ?? {}
    const method = (config["method"] as string | undefined) ?? "GET"
    let url = (config["url"] as string | undefined) ?? ""
    const headersField = config["headers"] as string | undefined
    const body = config["body"] as string | Record<string, unknown> | undefined
    const timeout = (config["timeout"] as number | undefined) ?? 30

    if (!url) {
      throw new Error("URL is required for HTTP request")
    }

    url = this.substituteVariables(url, { allowSecrets: false })

    if (this.deps.baseUrl && !url.startsWith("http")) {
      url = `${this.deps.baseUrl}${url}`
    }

    const headers = this.normalizeKeyValueField(headersField)

    let bodyStr: string | undefined
    if (body !== undefined && body !== null) {
      if (typeof body === "string") {
        bodyStr = this.substituteVariables(body)
      } else {
        bodyStr = JSON.stringify(body)
        bodyStr = this.substituteVariables(bodyStr)
        if (!headers["Content-Type"] && !headers["content-type"]) {
          headers["Content-Type"] = "application/json"
        }
      }
    }

    const startTime = Date.now()

    try {
      this.deps.http.validateUrl(url)

      const fetchInit: UndiciRequestInit = {
        method,
        headers,
        signal: AbortSignal.timeout(timeout * 1000),
      }
      if (bodyStr !== undefined && method !== "GET") {
        fetchInit.body = bodyStr
      }

      const response = await this.deps.http.safeFetch(url, fetchInit)
      const responseText = await response.text()
      const statusCode = response.status
      const duration = Date.now() - startTime

      let responseBody: unknown
      try {
        responseBody = JSON.parse(responseText)
      } catch {
        responseBody = responseText
      }

      let status: string
      if (statusCode >= 200 && statusCode < 300) status = "success"
      else if (statusCode >= 300 && statusCode < 400) status = "redirect"
      else if (statusCode >= 400 && statusCode < 500) status = "client_error"
      else if (statusCode >= 500) status = "server_error"
      else status = "unknown"

      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value
      })

      const result: NodeResult = {
        status,
        statusCode,
        headers: responseHeaders,
        body: responseBody,
        duration,
        method,
        url,
        response: {
          body: responseBody,
          headers: responseHeaders,
          statusCode,
        },
      }

      const extractors = config["extractors"] as Record<string, string> | undefined
      if (extractors) {
        this.extractVariables(extractors, result)
      }

      return result
    } catch (error) {
      if (error instanceof SafeUrlError) {
        return { status: "error", error: `SSRF blocked: ${error.message}`, method, url, duration: 0 }
      }
      return { status: "error", error: String(error), method, url, duration: Date.now() - startTime }
    }
  }

  // -------------------- Delay --------------------

  private async executeDelay(node: WorkflowNode, cancelSignal?: AbortSignal): Promise<NodeResult> {
    const config = node.config ?? {}
    const durationMs = (config["duration"] as number | undefined) ?? 1000

    if (this.deps.baseUrl) {
      return { status: "success", duration: 0, message: "Delayed for 0 seconds (harness mode)" }
    }

    return new Promise<NodeResult>((resolve) => {
      const timer = setTimeout(() => {
        resolve({ status: "success", duration: durationMs / 1000, message: `Delayed for ${durationMs / 1000} seconds` })
      }, durationMs)

      if (cancelSignal) {
        cancelSignal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer)
            resolve({ status: "cancelled", duration: 0, message: "Delay cancelled" })
          },
          { once: true },
        )
      }
    })
  }

  // -------------------- Assertion --------------------

  private async executeAssertion(node: WorkflowNode): Promise<NodeResult> {
    const config = node.config ?? {}

    type AssertionDef = { field?: string; path?: string; operator: string; expected?: unknown; source?: string }
    let assertions: AssertionDef[]

    const configAssertions = config["assertions"]
    if (Array.isArray(configAssertions)) {
      assertions = configAssertions as AssertionDef[]
    } else {
      const path = (config["path"] as string | undefined) ?? (config["field"] as string | undefined)
      const operator = config["operator"] as string | undefined
      if (path && operator) {
        assertions = [{
          field: (config["field"] as string | undefined) ?? path,
          path: (config["path"] as string | undefined) ?? path,
          operator,
          expected: config["expected"],
          source: (config["source"] as string | undefined) ?? "prev",
        }]
      } else {
        assertions = []
      }
    }

    if (assertions.length === 0) {
      return { status: "success", assertionOutcome: "pass", message: "No assertions configured" }
    }

    const failedAssertions: Array<{ index: number; message: string }> = []
    const passedAssertions: Array<{ index: number; message: string }> = []

    for (let idx = 0; idx < assertions.length; idx++) {
      const assertion = assertions[idx]!
      try {
        const result = this.evaluateAssertion(assertion)
        if (result.passed) {
          passedAssertions.push({ index: idx, message: result.message })
        } else {
          failedAssertions.push({ index: idx, message: result.message })
        }
      } catch (error) {
        failedAssertions.push({ index: idx, message: `Error evaluating assertion: ${String(error)}` })
      }
    }

    const outcome: "pass" | "fail" = failedAssertions.length > 0 ? "fail" : "pass"

    if (failedAssertions.length > 0) {
      const failedDetails = failedAssertions.map((f) => `Assertion ${f.index + 1}: ${f.message}`).join("\n")
      return {
        status: "failed",
        assertionOutcome: outcome,
        message: `Assertion failed: ${failedAssertions.length}/${assertions.length} assertions failed\n${failedDetails}`,
      }
    }

    return {
      status: "success",
      assertionOutcome: outcome,
      message: `All ${assertions.length} assertions passed`,
    }
  }

  private evaluateAssertion(assertion: {
    field?: string
    path?: string
    operator: string
    expected?: unknown
    source?: string
  }): { passed: boolean; message: string } {
    const source = assertion.source ?? "prev"
    const path = assertion.field ?? assertion.path ?? ""
    const operator = assertion.operator
    const expected = assertion.expected

    let actual: unknown

    if (source === "prev") {
      let lastResult: NodeResult | undefined
      for (const result of [...this.results.values()].reverse()) {
        if (result.type === "http-request") {
          lastResult = result
          break
        }
      }
      if (!lastResult) {
        return { passed: false, message: "No previous HTTP request result found" }
      }

      let cleanPath = path
      if (path.startsWith("response.")) {
        cleanPath = path.slice(9)
      }

      actual = this.getNestedValue(lastResult, cleanPath)
    } else if (source === "variables") {
      actual = this.workflowVariables[path]
    } else if (source === "status") {
      const lastResult = [...this.results.values()].pop()
      actual = lastResult?.statusCode
    } else {
      return { passed: false, message: `Unknown source: ${source}` }
    }

    try {
      const passed = this.compareValues(actual, operator, expected)
      const message = `${source}.${path} ${operator} ${String(expected)}: ${String(actual)}`
      return { passed, message }
    } catch (error) {
      return { passed: false, message: `Comparison error: ${String(error)}` }
    }
  }

  private compareValues(actual: unknown, operator: string, expected: unknown): boolean {
    if (operator === "exists") return actual !== null && actual !== undefined
    if (operator === "notExists") return actual === null || actual === undefined

    if (operator === "count") {
      let actualCount: number
      if (Array.isArray(actual) || typeof actual === "string") {
        actualCount = actual.length
      } else if (typeof actual === "object" && actual !== null) {
        actualCount = Object.keys(actual).length
      } else {
        actualCount = actual !== null && actual !== undefined ? Number(actual) : 0
      }
      const expectedCount = expected !== null && expected !== undefined ? Number(expected) : 0
      return actualCount === expectedCount
    }

    if (Array.isArray(actual) || (typeof actual === "object" && actual !== null && !Array.isArray(actual))) {
      if (["gt", "gte", "lt", "lte", "equals", "notEquals"].includes(operator)) {
        actual = Array.isArray(actual) ? actual.length : Object.keys(actual).length
      }
    }

    let expectedNum: number | null = null
    let actualNum: number | null = null
    try {
      if (expected !== null && expected !== undefined) {
        const n = Number(expected)
        if (!Number.isNaN(n)) expectedNum = n
      }
      if (actual !== null && actual !== undefined) {
        const n = Number(actual)
        if (!Number.isNaN(n)) actualNum = n
      }
    } catch {
      expectedNum = null
      actualNum = null
    }

    const actualStr = actual !== null && actual !== undefined ? String(actual) : ""
    const expectedStr = expected !== null && expected !== undefined ? String(expected) : ""

    switch (operator) {
      case "equals":
        if (expectedNum !== null && actualNum !== null) return actualNum === expectedNum
        return actualStr === expectedStr
      case "notEquals":
        if (expectedNum !== null && actualNum !== null) return actualNum !== expectedNum
        return actualStr !== expectedStr
      case "contains":
        return actualStr.includes(expectedStr)
      case "notContains":
        return !actualStr.includes(expectedStr)
      case "gt":
        return expectedNum !== null && actualNum !== null && actualNum > expectedNum
      case "gte":
        return expectedNum !== null && actualNum !== null && actualNum >= expectedNum
      case "lt":
        return expectedNum !== null && actualNum !== null && actualNum < expectedNum
      case "lte":
        return expectedNum !== null && actualNum !== null && actualNum <= expectedNum
      default:
        throw new Error(`Unknown operator: ${operator}`)
    }
  }

  // -------------------- Merge --------------------

  private async executeMerge(node: WorkflowNode, edges: readonly WorkflowEdge[]): Promise<NodeResult> {
    const config = node.config ?? {}
    const mergeStrategy = (config["mergeStrategy"] as string | undefined) ?? "all"
    const nodeId = node.nodeId

    if (this.mergeCompleted.has(nodeId)) {
      return { status: "success", mergedByOther: true }
    }

    const incomingEdges = edges.filter((e) => e.target === nodeId)
    const predecessorNodeIds = incomingEdges.map((e) => e.source)

    if (mergeStrategy === "all" || mergeStrategy === "conditional") {
      let missing = predecessorNodeIds.filter((id) => !this.results.has(id) && !this.failedNodes.has(id))
      if (missing.length > 0) {
        const maxWait = 30000
        const waitInterval = 100
        let elapsed = 0
        while (missing.length > 0 && elapsed < maxWait) {
          await new Promise((resolve) => setTimeout(resolve, waitInterval))
          elapsed += waitInterval
          missing = predecessorNodeIds.filter((id) => !this.results.has(id) && !this.failedNodes.has(id))
        }
        if (missing.length > 0) {
          throw new Error(`Timeout waiting for predecessors: ${missing.join(", ")}`)
        }
      }

      const failed = predecessorNodeIds.filter((id) => this.failedNodes.has(id))
      if (failed.length > 0) {
        throw new Error(`Cannot merge: ${failed.length} predecessor(s) failed`)
      }
    } else if (mergeStrategy === "any" || mergeStrategy === "first") {
      const completed = predecessorNodeIds.filter((id) => this.results.has(id))
      if (completed.length === 0) {
        throw new Error(`All ${predecessorNodeIds.length} branches failed or timed out`)
      }
    }

    this.mergeCompleted.add(nodeId)

    const predecessorResults: Array<readonly [string, NodeResult]> = []
    for (const predId of predecessorNodeIds) {
      const dataNodeId = this.findDataProducingAncestor(predId, edges)
      const result = this.results.get(dataNodeId)
      if (result && result.type === "http-request") {
        predecessorResults.push([dataNodeId, result])
      }
    }

    this.branchResults.set(nodeId, predecessorResults)

    return {
      status: "success",
      message: `Merged ${predecessorResults.length} branches using '${mergeStrategy}' strategy`,
      mergeStrategy,
      branchCount: predecessorResults.length,
    }
  }

  private findDataProducingAncestor(nodeId: string, edges: readonly WorkflowEdge[]): string {
    const visited = new Set<string>()
    const visit = (id: string): string => {
      if (visited.has(id)) return id
      visited.add(id)
      const result = this.results.get(id)
      if (result && result.type === "http-request") return id
      const incoming = edges.filter((e) => e.target === id)
      if (incoming.length === 0) return id
      if (incoming.length === 1) return visit(incoming[0]!.source)
      return id
    }
    return visit(nodeId)
  }

  // -------------------- Template substitution --------------------

  private substituteVariables(text: string, options: { allowSecrets?: boolean } = {}): string {
    const allowSecrets = options.allowSecrets ?? true

    return text.replace(/\{\{([^}]+)\}\}/g, (match, rawPath: string) => {
      const varPath = rawPath.trim()

      // Function call
      const funcMatch = varPath.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\((.*)\)$/)
      if (funcMatch) {
        const funcName = funcMatch[1]!
        const params = funcMatch[2]!.trim()
        const func = this.deps.functions.getFunction(funcName)
        if (func) {
          try {
            const paramList = params
              ? params.split(",").map((p) => p.trim().replace(/^["']|["']$/g, ""))
              : []
            return String(func(...paramList))
          } catch {
            return match
          }
        }
      }

      // Secrets
      if (varPath.startsWith("secrets.")) {
        if (!allowSecrets) {
          throw new Error("Secret substitution not allowed in URL/query/path contexts")
        }
        const secretName = varPath.slice(8)
        const value = this.deps.secrets?.[secretName]
        return value !== undefined ? value : match
      }

      // Environment variables
      if (varPath.startsWith("env.")) {
        const pathParts = varPath.slice(4).split(".")
        let value: unknown = this.environmentVariables
        for (const part of pathParts) {
          if (typeof value === "object" && value !== null) {
            value = (value as Record<string, unknown>)[part]
          } else {
            return match
          }
        }
        return value !== undefined && value !== null ? String(value) : match
      }

      // Workflow variables
      if (varPath.startsWith("variables.")) {
        const pathParts = varPath.slice(10).split(".")
        let value: unknown = this.workflowVariables
        for (const part of pathParts) {
          if (typeof value === "object" && value !== null) {
            value = (value as Record<string, unknown>)[part]
          } else {
            return match
          }
        }
        return value !== undefined && value !== null ? String(value) : match
      }

      // Previous results
      if (varPath.startsWith("prev")) {
        const indexMatch = varPath.match(/^prev\[(\d+)\]\.(.+)$/)
        if (indexMatch) {
          const branchIndex = Number.parseInt(indexMatch[1]!, 10)
          const pathAfterIndex = indexMatch[2]!

          if (this.currentBranchContext.length > 0) {
            if (branchIndex >= 0 && branchIndex < this.currentBranchContext.length) {
              const entry = this.currentBranchContext[branchIndex]!
              const [, prevResult] = entry
              const pathParts = pathAfterIndex.split(".")
              return this.resolveDottedPath(prevResult, pathParts, match)
            }
            return match
          }

          const resultsList = [...this.results.values()]
          if (branchIndex >= 0 && branchIndex < resultsList.length) {
            const prevResult = resultsList[branchIndex]!
            const pathParts = pathAfterIndex.split(".")
            return this.resolveDottedPath(prevResult, pathParts, match)
          }
          return match
        }

        if (this.results.size > 0) {
          const prevResult = [...this.results.values()].pop()!
          const pathParts = varPath.slice(5).split(".")
          return this.resolveDottedPath(prevResult, pathParts, match)
        }
        return match
      }

      // Direct node ID access
      const firstPart = varPath.split(".")[0]!
      const nodeResult = this.results.get(firstPart)
      if (nodeResult) {
        const pathParts = varPath.split(".").slice(1)
        return this.resolveDottedPath(nodeResult, pathParts, match)
      }

      return match
    })
  }

  private resolveDottedPath(value: unknown, pathParts: string[], fallback: string): string {
    let current: unknown = value
    for (const part of pathParts) {
      const arrayMatch = part.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$/)
      if (arrayMatch) {
        const key = arrayMatch[1]!
        const index = Number.parseInt(arrayMatch[2]!, 10)
        if (typeof current === "object" && current !== null && key in current) {
          current = (current as Record<string, unknown>)[key]
          if (Array.isArray(current) && index >= 0 && index < current.length) {
            current = current[index]
          } else {
            return fallback
          }
        } else {
          return fallback
        }
      } else if (typeof current === "object" && current !== null) {
        current = (current as Record<string, unknown>)[part]
      } else {
        return fallback
      }
    }
    return current !== undefined && current !== null ? String(current) : fallback
  }

  // -------------------- Extraction --------------------

  private extractVariables(extractors: Record<string, string>, response: NodeResult): void {
    for (const [varName, varPath] of Object.entries(extractors)) {
      try {
        const value = this.getNestedValue(response, varPath)
        if (value !== undefined && value !== null) {
          this.workflowVariables[varName] = value
        }
      } catch {
        // Extraction failed — skip
      }
    }
  }

  private getNestedValue(obj: unknown, path: string): unknown {
    if (!obj || !path) return undefined
    const parts = path.split(".")
    let value: unknown = obj
    for (const part of parts) {
      const arrayMatch = part.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$/)
      if (arrayMatch) {
        const key = arrayMatch[1]!
        const index = Number.parseInt(arrayMatch[2]!, 10)
        if (typeof value === "object" && value !== null && key in value) {
          value = (value as Record<string, unknown>)[key]
          if (Array.isArray(value) && index >= 0 && index < value.length) {
            value = value[index]
          } else {
            return undefined
          }
        } else {
          return undefined
        }
      } else if (typeof value === "object" && value !== null) {
        value = (value as Record<string, unknown>)[part]
      } else {
        return undefined
      }
      if (value === undefined || value === null) return undefined
    }
    return value
  }

  // -------------------- Key-value field normalization --------------------

  private normalizeKeyValueField(value: unknown): Record<string, string> {
    if (!value || value === "") return {}

    if (typeof value === "string") {
      const result: Record<string, string> = {}
      for (const line of value.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const eqIdx = trimmed.indexOf("=")
        const colonIdx = trimmed.indexOf(":")
        let sepIdx = -1
        if (eqIdx >= 0 && (colonIdx < 0 || eqIdx < colonIdx)) sepIdx = eqIdx
        else if (colonIdx >= 0) sepIdx = colonIdx
        if (sepIdx < 0) continue
        const key = trimmed.slice(0, sepIdx).trim()
        const val = trimmed.slice(sepIdx + 1).trim()
        result[key] = this.substituteVariables(val)
      }
      return result
    }

    if (Array.isArray(value)) {
      const result: Record<string, string> = {}
      for (const entry of value) {
        if (typeof entry !== "object" || entry === null) continue
        const e = entry as Record<string, unknown>
        if (e["active"] === false) continue
        const key = e["key"]
        if (key === undefined || key === null) continue
        const rawValue = (e["value"] as string | undefined) ?? ""
        result[String(key)] = this.substituteVariables(String(rawValue))
      }
      return result
    }

    return {}
  }

  // -------------------- Status tracking --------------------

  private updateNodeStatus(nodeId: string, status: RunnerNodeStatus, _result?: NodeResult): void {
    this.nodeStatuses.set(nodeId, status)
    if (this.deps.emitProgress) {
      this.deps.emitProgress({
        kind: "node.completed",
        runId: "harness",
        nodeId,
        status,
        variables: { ...this.workflowVariables },
      })
    }
  }

  // -------------------- Output building --------------------

  private buildOutput(
    caseName: string | undefined,
    startedAt: string,
    seed: string | undefined,
    status: "passed" | "failed",
  ): ExecutorOutput {
    const result: ExecutorOutput = {
      status,
      startedAt,
      nodeStatuses: Object.fromEntries(this.nodeStatuses),
      extractedVariables: { ...this.workflowVariables },
      outputs: this.buildOutputs(),
    }
    if (caseName !== undefined && seed !== undefined) {
      return { ...result, caseName, seed }
    }
    if (caseName !== undefined) {
      return { ...result, caseName }
    }
    if (seed !== undefined) {
      return { ...result, seed }
    }
    return result
  }

  private buildOutputs(): Record<string, unknown> {
    const outputs: Record<string, unknown> = {}
    for (const [nodeId, result] of this.results.entries()) {
      if (result.type === "http-request") {
        outputs[nodeId] = { status: result.statusCode, body: result.body }
      } else if (result.type === "assertion") {
        outputs[nodeId] = { passed: result.assertionOutcome === "pass", message: result.message }
      } else if (result.type === "merge") {
        const branchResults = this.branchResults.get(nodeId)
        if (branchResults) {
          outputs[nodeId] = { branches: branchResults.map(([id]) => id), status: "joined" }
        }
      }
    }
    return outputs
  }
}
