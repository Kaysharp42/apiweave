import type { JsonValue } from "../types/JsonValue"
import type { Run } from "../types/Run"
import type { RunResult } from "../types/RunResult"
import type { VariableProvenance } from "../types/VariableProvenance"
import type { VariableProvenanceMap } from "../types/VariableProvenanceMap"
import type { VariableProvenanceNode } from "../types/VariableProvenanceNode"
import type { WorkflowDiagnostic } from "../types/WorkflowDiagnostic"
import type { WorkflowGraphInput } from "../types/WorkflowGraphInput"
import type { WorkflowDiagnosis } from "../types/WorkflowDiagnosis"
import type { WorkflowEdge } from "../types/WorkflowEdge"
import type { WorkflowNode } from "../types/WorkflowNode"
import { AssertionOperatorSchema } from "../zod-schemas/AssertionOperatorSchema"
import { AssertionSourceSchema } from "../zod-schemas/AssertionSourceSchema"

const VARIABLE_REF_RE = /\{\{\s*variables\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g
const SECRET_REF_RE = /\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g
const SEVERITY_ORDER: Readonly<Record<WorkflowDiagnostic["severity"], number>> = {
  error: 0,
  warning: 1,
  notice: 2,
}

function nodeLabel(node: VariableProvenanceNode): string {
  return typeof node.label === "string" && node.label.trim() ? node.label : node.nodeId
}

function forEachConfigString(
  config: Readonly<Record<string, unknown>> | undefined,
  callback: (rootKey: string, value: string) => void,
): void {
  if (config === undefined) return
  const visit = (rootKey: string, value: unknown): void => {
    if (typeof value === "string") {
      callback(rootKey, value)
    } else if (Array.isArray(value)) {
      for (const item of value) visit(rootKey, item)
    } else if (value !== null && typeof value === "object") {
      for (const child of Object.values(value as Readonly<Record<string, unknown>>)) visit(rootKey, child)
    }
  }
  for (const [key, value] of Object.entries(config)) visit(key, value)
}

/** Producer/consumer facts over canonical persisted nodes, with no ReactFlow dependency. */
export function analyzeVariableProvenance(nodes: readonly VariableProvenanceNode[]): VariableProvenanceMap {
  const map: Record<string, VariableProvenance> = {}
  const ensure = (name: string): VariableProvenance => {
    const existing = map[name]
    if (existing !== undefined) return existing
    const fresh: VariableProvenance = { producers: [], consumers: [] }
    map[name] = fresh
    return fresh
  }

  for (const node of nodes) {
    const config = node.config as Readonly<Record<string, unknown>> | undefined
    const extractors = node.config?.["extractors"]
    if (extractors !== null && typeof extractors === "object" && !Array.isArray(extractors)) {
      for (const [variableName, path] of Object.entries(extractors as Readonly<Record<string, unknown>>)) {
        if (typeof path !== "string") continue
        const entry = ensure(variableName)
        map[variableName] = {
          producers: [...entry.producers, { nodeId: node.nodeId, nodeLabel: nodeLabel(node), path }],
          consumers: entry.consumers,
        }
      }
    }

    const references = new Map<string, Set<string>>()
    forEachConfigString(config, (rootKey, value) => {
      VARIABLE_REF_RE.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = VARIABLE_REF_RE.exec(value)) !== null) {
        const variableName = match[1]!
        const fields = references.get(variableName) ?? new Set<string>()
        fields.add(rootKey)
        references.set(variableName, fields)
      }
    })
    for (const [variableName, fields] of references) {
      const entry = ensure(variableName)
      map[variableName] = {
        producers: entry.producers,
        consumers: [
          ...entry.consumers,
          { nodeId: node.nodeId, nodeLabel: nodeLabel(node), fields: [...fields].sort() },
        ],
      }
    }
  }

  return map
}

function buildGraph(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[]) {
  const nodesById = new Map<string, WorkflowNode>()
  for (const node of nodes) if (!nodesById.has(node.nodeId)) nodesById.set(node.nodeId, node)
  const predecessors = new Map<string, Set<string>>()
  const successors = new Map<string, Set<string>>()
  for (const nodeId of nodesById.keys()) {
    predecessors.set(nodeId, new Set())
    successors.set(nodeId, new Set())
  }
  for (const edge of edges) {
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) continue
    predecessors.get(edge.target)!.add(edge.source)
    successors.get(edge.source)!.add(edge.target)
  }
  return { nodesById, predecessors, successors }
}

function traverse(startIds: readonly string[], adjacency: ReadonlyMap<string, ReadonlySet<string>>): Set<string> {
  const visited = new Set<string>()
  const queue = [...startIds]
  let queueIndex = 0
  while (queueIndex < queue.length) {
    const nodeId = queue[queueIndex++]!
    if (visited.has(nodeId)) continue
    visited.add(nodeId)
    for (const next of adjacency.get(nodeId) ?? []) queue.push(next)
  }
  return visited
}

function upstreamHttpSources(
  nodeId: string,
  nodesById: ReadonlyMap<string, WorkflowNode>,
  predecessors: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  const sources = new Set<string>()
  const visited = new Set<string>()
  const queue = [...(predecessors.get(nodeId) ?? [])]
  let queueIndex = 0
  while (queueIndex < queue.length) {
    const candidateId = queue[queueIndex++]!
    if (visited.has(candidateId)) continue
    visited.add(candidateId)
    const candidate = nodesById.get(candidateId)
    if (candidate?.type === "http-request") {
      sources.add(candidateId)
      continue
    }
    for (const predecessor of predecessors.get(candidateId) ?? []) queue.push(predecessor)
  }
  return [...sources].sort()
}

function isRecord(value: unknown): value is Readonly<Record<string, JsonValue>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function responseMetadata(result: RunResult): Readonly<Record<string, JsonValue>> {
  return isRecord(result.response) ? result.response : {}
}

function collectSecretReferenceNames(nodes: readonly WorkflowNode[]): string[] {
  const names = new Set<string>()
  for (const node of nodes) {
    forEachConfigString(node.config as Readonly<Record<string, unknown>> | undefined, (_rootKey, value) => {
      SECRET_REF_RE.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = SECRET_REF_RE.exec(value)) !== null) names.add(match[1]!)
    })
  }
  return [...names].sort()
}

function statusCodeOf(result: RunResult): number | undefined {
  const statusCode = responseMetadata(result)["statusCode"]
  return typeof statusCode === "number" ? statusCode : undefined
}

function pathTargetsResponseBody(path: string): boolean {
  // Persisted graphs are read without re-validation, so a path may be non-string.
  if (typeof path !== "string") return false
  const normalized = path.startsWith("response.") ? path.slice("response.".length) : path
  return normalized === "body" || normalized.startsWith("body.") || normalized.startsWith("body[")
}

/**
 * The one predicate deciding whether a runtime path can address a value in an
 * HTTP node's stored result. Exported because the analyzer (`workflow_diagnose`)
 * and the authoring service (`assertion_validate`/`assertion_apply`) must agree:
 * a path one accepts and the other rejects is a trap an agent can only discover
 * by running the workflow.
 *
 * Mirrors `WorkflowExecutor.evaluateAssertion`, which strips a leading
 * `response.` and reads the rest off the node result — so `body.id`,
 * `response.body.id`, `response.headers.content-type`, `statusCode` and
 * `duration` all address something real, and anything else does not.
 */
export function isValidRuntimePath(path: string, includeDuration: boolean): boolean {
  if (typeof path !== "string") return false
  const normalized = path.startsWith("response.") ? path.slice("response.".length) : path
  const parts = normalized.split(".")
  if (parts.length === 0 || parts.some((part) => part.length === 0)) return false
  for (const part of parts) {
    if ((part.includes("[") || part.includes("]")) && !/^[A-Za-z_][A-Za-z0-9_]*\[\d+\]$/.test(part)) {
      return false
    }
  }
  const root = parts[0]!.replace(/\[\d+\]$/, "")
  if (root === "statusCode" || root === "duration") {
    return parts.length === 1 && !parts[0]!.includes("[") && (root !== "duration" || includeDuration)
  }
  return root === "body" || root === "headers"
}

function diagnostic(
  code: string,
  severity: WorkflowDiagnostic["severity"],
  category: WorkflowDiagnostic["category"],
  nodeIds: readonly string[],
  message: string,
  evidence: Readonly<Record<string, JsonValue>> = {},
  remediation: WorkflowDiagnostic["remediation"] = null,
  confidence: WorkflowDiagnostic["confidence"] = "high",
): WorkflowDiagnostic {
  return {
    code,
    severity,
    category,
    nodeIds: [...nodeIds].sort(),
    message,
    evidence: { ...evidence },
    remediation,
    confidence,
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function addTopologyDiagnostics(workflow: WorkflowGraphInput, diagnostics: WorkflowDiagnostic[]): void {
  const nodeCounts = new Map<string, number>()
  for (const node of workflow.nodes) nodeCounts.set(node.nodeId, (nodeCounts.get(node.nodeId) ?? 0) + 1)
  for (const [nodeId, count] of nodeCounts) {
    if (count > 1) {
      diagnostics.push(diagnostic(
        "duplicate_node_id",
        "error",
        "topology",
        [nodeId],
        "The workflow contains duplicate node IDs.",
        { nodeId, count },
        { kind: "assign_unique_node_id", nodeId },
      ))
    }
  }

  const edgeCounts = new Map<string, number>()
  for (const edge of workflow.edges) edgeCounts.set(edge.edgeId, (edgeCounts.get(edge.edgeId) ?? 0) + 1)
  for (const [edgeId, count] of edgeCounts) {
    if (count > 1) {
      diagnostics.push(diagnostic(
        "duplicate_edge_id",
        "error",
        "topology",
        [],
        "The workflow contains duplicate edge IDs.",
        { edgeId, count },
        { kind: "assign_unique_edge_id", edgeId },
      ))
    }
  }

  const starts = workflow.nodes.filter((node) => node.type === "start").map((node) => node.nodeId)
  const ends = workflow.nodes.filter((node) => node.type === "end").map((node) => node.nodeId)
  if (starts.length === 0) {
    diagnostics.push(diagnostic("missing_start_node", "error", "topology", [], "The workflow has no start node.", {}, { kind: "add_start_node" }))
  } else if (starts.length > 1) {
    diagnostics.push(diagnostic("duplicate_start_node", "error", "topology", starts, "The workflow has more than one start node.", { count: starts.length }, { kind: "keep_single_start_node" }))
  }
  if (ends.length === 0) {
    diagnostics.push(diagnostic("missing_end_node", "error", "topology", [], "The workflow has no end node.", {}, { kind: "add_end_node" }))
  } else if (ends.length > 1) {
    diagnostics.push(diagnostic("duplicate_end_node", "error", "topology", ends, "The workflow has more than one end node.", { count: ends.length }, { kind: "keep_single_end_node" }))
  }

  const { nodesById, successors } = buildGraph(workflow.nodes, workflow.edges)
  for (const edge of workflow.edges) {
    const missing = [!nodesById.has(edge.source) ? edge.source : null, !nodesById.has(edge.target) ? edge.target : null]
      .filter((nodeId): nodeId is string => nodeId !== null)
    if (missing.length > 0) {
      diagnostics.push(diagnostic(
        "dangling_edge",
        "error",
        "topology",
        missing,
        "An edge references a node that does not exist.",
        { edgeId: edge.edgeId, source: edge.source, target: edge.target },
        { kind: "remove_or_reconnect_edge", edgeId: edge.edgeId },
      ))
    }
  }

  if (starts.length > 0) {
    const reachable = traverse(starts, successors)
    const unreachable = [...nodesById.keys()].filter((nodeId) => !reachable.has(nodeId)).sort()
    if (unreachable.length > 0) {
      diagnostics.push(diagnostic(
        "unreachable_nodes",
        "warning",
        "topology",
        unreachable,
        "Some nodes cannot be reached from a start node.",
        { count: unreachable.length },
        { kind: "connect_or_remove_nodes" },
      ))
    }
  }

  const states = new Map<string, "active" | "complete">()
  const stack: string[] = []
  const cycleNodeIds = new Set<string>()
  for (const rootNodeId of nodesById.keys()) {
    if (states.has(rootNodeId)) continue
    const frames: Array<{ readonly nodeId: string; readonly targets: readonly string[]; index: number }> = [{
      nodeId: rootNodeId,
      targets: [...(successors.get(rootNodeId) ?? [])],
      index: 0,
    }]
    states.set(rootNodeId, "active")
    stack.push(rootNodeId)
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!
      const target = frame.targets[frame.index]
      if (target !== undefined) {
        frame.index += 1
        if (states.get(target) === "active") {
          const cycleStart = stack.lastIndexOf(target)
          for (const cycleNodeId of stack.slice(cycleStart)) cycleNodeIds.add(cycleNodeId)
        } else if (!states.has(target)) {
          states.set(target, "active")
          stack.push(target)
          frames.push({ nodeId: target, targets: [...(successors.get(target) ?? [])], index: 0 })
        }
      } else {
        frames.pop()
        stack.pop()
        states.set(frame.nodeId, "complete")
      }
    }
  }
  if (cycleNodeIds.size > 0) {
    const cycleNodes = [...cycleNodeIds].sort()
    diagnostics.push(diagnostic(
      "cycle_detected",
      "error",
      "topology",
      cycleNodes,
      "The workflow graph contains a cycle.",
      { count: cycleNodes.length },
      { kind: "remove_cycle_edge" },
    ))
  }
}

function addAssertionAndBranchDiagnostics(workflow: WorkflowGraphInput, diagnostics: WorkflowDiagnostic[]): void {
  const { nodesById, predecessors } = buildGraph(workflow.nodes, workflow.edges)
  // One pass collects the assertion nodeIds that wire their `fail` handle; the
  // notice below needs the whole count per workflow. A real author wired all 65
  // assertion `fail` handles to a single `end` because the guides could be read
  // as "every handle must carry an edge" — they read the empty-handle warning as
  // a mandate. The notice points at the shorter form; leaving `fail` unwired is
  // the normal expected shape and the run still records the failed assertion.
  let assertionCount = 0
  const failWiredIds: string[] = []
  for (const node of workflow.nodes) {
    if (node.type !== "assertion") continue
    assertionCount++
    const hasFailEdge = workflow.edges.some(
      (edge) => edge.source === node.nodeId && edge.sourceHandle === "fail",
    )
    if (hasFailEdge) failWiredIds.push(node.nodeId)
  }
  for (const node of workflow.nodes) {
    if (node.type !== "assertion") continue
    const assertions = node.config?.assertions ?? []
    if (assertions.length === 0) {
      diagnostics.push(diagnostic(
        "assertion_rules_missing",
        "warning",
        "assertion",
        [node.nodeId],
        "The assertion node has no configured rules.",
        {},
        { kind: "add_assertion_rule", nodeId: node.nodeId },
      ))
    }
    const sources = upstreamHttpSources(node.nodeId, nodesById, predecessors)
    if (sources.length === 0) {
      diagnostics.push(diagnostic(
        "assertion_source_missing",
        "error",
        "assertion",
        [node.nodeId],
        "The assertion node has no upstream HTTP source.",
        {},
        { kind: "connect_http_source", nodeId: node.nodeId },
      ))
    } else if (sources.length > 1) {
      diagnostics.push(diagnostic(
        "assertion_source_ambiguous",
        "error",
        "assertion",
        [node.nodeId, ...sources],
        "The assertion node has multiple upstream HTTP sources.",
        { sourceNodeIds: sources },
        { kind: "connect_single_http_source", nodeId: node.nodeId },
      ))
    }

    assertions.forEach((assertion, ruleIndex) => {
      const path = typeof assertion.path === "string" ? assertion.path.trim() : ""
      const sourceValid = AssertionSourceSchema.safeParse(assertion.source).success
      const operatorValid = AssertionOperatorSchema.safeParse(assertion.operator).success
      if (!sourceValid) {
        diagnostics.push(diagnostic(
          "assertion_source_unknown",
          "error",
          "assertion",
          [node.nodeId],
          "An assertion uses an unknown source.",
          { ruleIndex, source: String(assertion.source) },
          { kind: "select_assertion_source", nodeId: node.nodeId },
        ))
      }
      if (!operatorValid) {
        diagnostics.push(diagnostic(
          "assertion_operator_unknown",
          "error",
          "assertion",
          [node.nodeId],
          "An assertion uses an unknown operator.",
          { ruleIndex, operator: String(assertion.operator) },
          { kind: "select_assertion_operator", nodeId: node.nodeId },
        ))
      }
      const pathValid = !sourceValid
        ? true
        : assertion.source === "status"
          ? path === ""
          : assertion.source === "prev"
            ? isValidRuntimePath(path, true)
            : path.length > 0
      if (!pathValid) {
        diagnostics.push(diagnostic(
          "assertion_source_path_invalid",
          "error",
          "assertion",
          [node.nodeId],
          "An assertion path is incompatible with its selected source.",
          { ruleIndex, source: assertion.source, path },
          { kind: "update_assertion_path", nodeId: node.nodeId, path },
        ))
      }
      if (operatorValid && assertion.operator !== "exists" && assertion.operator !== "notExists" && assertion.expectedValue === undefined) {
        diagnostics.push(diagnostic(
          "assertion_expected_missing",
          "error",
          "assertion",
          [node.nodeId],
          "An assertion operator requires an expected value.",
          { ruleIndex, operator: assertion.operator },
          { kind: "set_assertion_expected", nodeId: node.nodeId },
        ))
      }
    })

    const outgoing = workflow.edges.filter((edge) => edge.source === node.nodeId)
    const handleCounts = new Map<string, number>()
    for (const edge of outgoing) {
      const handle = edge.sourceHandle ?? ""
      if (handle !== "pass" && handle !== "fail") {
        diagnostics.push(diagnostic(
          "assertion_branch_handle_invalid",
          "error",
          "branch",
          [node.nodeId, edge.target],
          "An assertion edge must use the pass or fail source handle.",
          { edgeId: edge.edgeId, sourceHandle: handle },
          { kind: "set_assertion_edge_handle", edgeId: edge.edgeId },
        ))
      } else {
        handleCounts.set(handle, (handleCounts.get(handle) ?? 0) + 1)
      }
    }
    for (const [handle, count] of handleCounts) {
      if (count > 1) {
        diagnostics.push(diagnostic(
          "assertion_branch_duplicate",
          "notice",
          "branch",
          [node.nodeId],
          "An assertion outcome fans out to more than one edge. The runtime supports this — the branches run in parallel after the gate. Wire them this way deliberately; introduce a merge node only if a downstream node needs all branches settled before it runs.",
          { sourceHandle: handle, count },
          { kind: "keep_single_assertion_branch", nodeId: node.nodeId },
          "high",
        ))
      }
    }
  }

  // Single notice per workflow — fires only when every assertion wires its
  // `fail` handle. Notice, not warning: the graph is verbose, not wrong, and
  // the run still reports each failed assertion. Suggests the shorter form.
  if (assertionCount > 0 && failWiredIds.length === assertionCount) {
    diagnostics.push(diagnostic(
      "assertion_fail_wired_on_all",
      "notice",
      "branch",
      failWiredIds,
      "Every assertion wires its `fail` handle. An unwired `fail` is the normal, expected shape: the run records the failed assertion and that branch terminates. Wire `fail` only when you want a distinct failure path (a cleanup request, a notification, a compensating call).",
      { assertionCount },
      null,
      "high",
    ))
  }
}

function addDataflowDiagnostics(workflow: WorkflowGraphInput, diagnostics: WorkflowDiagnostic[]): void {
  const { successors } = buildGraph(workflow.nodes, workflow.edges)
  const provenance = analyzeVariableProvenance(workflow.nodes)
  const variables = workflow.variables ?? {}
  for (const node of workflow.nodes) {
    if (node.type !== "http-request") continue
    for (const [variableName, path] of Object.entries(node.config?.extractors ?? {})) {
      // Persisted graphs are read without re-validation, so a drifted/imported
      // config can carry a non-string extractor value — treat it as invalid
      // rather than letting `path.startsWith` throw.
      if (typeof path !== "string" || !path.startsWith("response.") || !isValidRuntimePath(path, false)) {
        diagnostics.push(diagnostic(
          "extractor_path_invalid",
          "error",
          "dataflow",
          [node.nodeId],
          "An extractor path does not use the canonical response shape.",
          { variableName, path },
          { kind: "update_extractor_path", nodeId: node.nodeId, path, variableName },
        ))
      }
    }
  }

  for (const [variableName, entry] of Object.entries(provenance)) {
    const hasManualValue = Object.prototype.hasOwnProperty.call(variables, variableName)
    if (!hasManualValue && entry.producers.length === 0 && entry.consumers.length > 0) {
      diagnostics.push(diagnostic(
        "variable_source_missing",
        "warning",
        "dataflow",
        entry.consumers.map((consumer) => consumer.nodeId),
        "A referenced variable has no manual value or extractor producer.",
        { variableName },
        { kind: "define_variable_or_extractor", variableName },
      ))
    }
    if (entry.producers.length > 1) {
      diagnostics.push(diagnostic(
        "variable_producer_duplicate",
        "warning",
        "dataflow",
        entry.producers.map((producer) => producer.nodeId),
        "More than one extractor produces the same variable.",
        { variableName, count: entry.producers.length },
        { kind: "keep_single_variable_producer", variableName },
      ))
    }
    for (const producer of entry.producers) {
      const downstream = traverse([producer.nodeId], successors)
      const invalidConsumers = entry.consumers
        .filter((consumer) =>
          (consumer.nodeId === producer.nodeId && !hasManualValue)
            || (consumer.nodeId !== producer.nodeId && !downstream.has(consumer.nodeId)),
        )
        .map((consumer) => consumer.nodeId)
      if (invalidConsumers.length > 0) {
        diagnostics.push(diagnostic(
          "variable_producer_not_upstream",
          "warning",
          "dataflow",
          [producer.nodeId, ...invalidConsumers],
          "A variable producer is not upstream of every consumer.",
          { variableName, producerNodeId: producer.nodeId, consumerNodeIds: invalidConsumers },
          { kind: "reconnect_variable_dataflow", nodeId: producer.nodeId, variableName },
        ))
      }
    }
  }
}

function addRunDiagnostics(workflow: WorkflowGraphInput, run: Run, diagnostics: WorkflowDiagnostic[]): void {
  const { nodesById, predecessors, successors } = buildGraph(workflow.nodes, workflow.edges)
  const resultsByNode = new Map(run.results.map((result) => [result.nodeId, result]))
  for (const result of run.results) {
    const node = nodesById.get(result.nodeId)
    if (node === undefined) {
      diagnostics.push(diagnostic(
        "run_result_unknown_node",
        "notice",
        "execution",
        [result.nodeId],
        "The run contains evidence for a node no longer present in the workflow.",
        {},
        null,
        "high",
      ))
      continue
    }

    if (node.type === "http-request") {
      const statusCode = statusCodeOf(result)
      const response = responseMetadata(result)
      if ((statusCode !== undefined && statusCode >= 400) || (result.status === "failed" && statusCode === undefined)) {
        const descendants = traverse([node.nodeId], successors)
        descendants.delete(node.nodeId)
        const blockedNodeIds = [...descendants].filter((nodeId) => {
          const downstreamResult = resultsByNode.get(nodeId)
          return downstreamResult === undefined || downstreamResult.status === "skipped"
        }).sort()
        diagnostics.push(diagnostic(
          "http_request_failed",
          "error",
          "execution",
          [node.nodeId, ...blockedNodeIds],
          statusCode === undefined
            ? "An HTTP request failed before a response status was available."
            : "An HTTP request returned an error status.",
          {
            ...(statusCode === undefined ? { failureKind: "transport" } : { statusCode }),
            blockedNodeIds,
          },
          { kind: "inspect_http_configuration", nodeId: node.nodeId },
      ))
      }
      if (response["truncated"] === true) {
        diagnostics.push(diagnostic(
          "response_body_truncated",
          "warning",
          "execution",
          [node.nodeId],
          "The recorded response body was truncated, so body evidence is incomplete.",
          {},
          { kind: "reduce_response_or_inspect_artifact", nodeId: node.nodeId },
        ))
      }
      const extractorNeedsBody = Object.values(node.config?.extractors ?? {})
        .some(pathTargetsResponseBody)
      const assertionNeedsBody = workflow.nodes.some((candidate) =>
        candidate.type === "assertion"
          && upstreamHttpSources(candidate.nodeId, nodesById, predecessors).includes(node.nodeId)
          && (candidate.config?.assertions ?? []).some((assertion) =>
            assertion.source === "prev" && pathTargetsResponseBody(assertion.path),
          ),
      )
      if (!Object.prototype.hasOwnProperty.call(response, "body") && (extractorNeedsBody || assertionNeedsBody)) {
        diagnostics.push(diagnostic(
          "response_body_unavailable",
          "warning",
          "execution",
          [node.nodeId],
          "The selected run has no recorded response body for configured body evidence.",
          {},
          { kind: "rerun_or_review_body_dependent_rules", nodeId: node.nodeId },
          "medium",
        ))
      }
      for (const outcome of result.extractorOutcomes ?? []) {
        if (!outcome.matched) {
          const typeMismatch = outcome.failureReason === "type-mismatch"
          diagnostics.push(diagnostic(
            typeMismatch ? "extractor_type_mismatch" : "extractor_path_missing",
            "error",
            "dataflow",
            [outcome.producerNodeId],
            typeMismatch
              ? "An extractor traversed a response value with an incompatible JSON type."
              : "An extractor matched no response field in the selected run.",
            {
              producerNodeId: outcome.producerNodeId,
              variableName: outcome.variableName,
              path: outcome.path,
              observed: typeMismatch ? "type_mismatch" : "path_missing",
            },
            { kind: "update_extractor_path", nodeId: outcome.producerNodeId, path: outcome.path, variableName: outcome.variableName },
          ))
        }
      }
    }

    if (node.type === "assertion") {
      const staticSources = upstreamHttpSources(node.nodeId, nodesById, predecessors)
      for (const evaluation of result.assertions ?? []) {
        if (staticSources.length === 1 && evaluation.sourceNodeId !== null && evaluation.sourceNodeId !== staticSources[0]) {
          diagnostics.push(diagnostic(
            "assertion_source_mismatch",
            "error",
            "assertion",
            [node.nodeId, evaluation.sourceNodeId, staticSources[0]!],
            "The assertion used a different HTTP source than the current graph resolves.",
            { observedSourceNodeId: evaluation.sourceNodeId, configuredSourceNodeId: staticSources[0]! },
            { kind: "reconnect_assertion_source", nodeId: node.nodeId },
          ))
        }
        if (evaluation.outcome !== "fail") continue
        const code = evaluation.reasonCode === "source-unavailable"
          ? "assertion_source_missing_at_run"
          : evaluation.reasonCode === "ambiguous-source"
            ? "assertion_source_ambiguous_at_run"
            : "assertion_failed"
        diagnostics.push(diagnostic(
          code,
          "error",
          "assertion",
          [node.nodeId, ...(evaluation.sourceNodeId === null ? [] : [evaluation.sourceNodeId])],
          evaluation.reasonCode === "source-unavailable"
            ? "An assertion source was unavailable in the selected run."
            : evaluation.reasonCode === "ambiguous-source"
              ? "An assertion source was ambiguous in the selected run."
              : "An assertion rule failed in the selected run.",
          {
            ruleIndex: evaluation.ruleIndex,
            source: evaluation.source,
            path: evaluation.path,
            operator: evaluation.operator,
            actualState: evaluation.actualState,
            actualType: evaluation.actualType,
            expectedState: evaluation.expectedState,
            expectedType: evaluation.expectedType,
            reasonCode: evaluation.reasonCode,
          },
          { kind: "review_assertion_rule", nodeId: node.nodeId, path: evaluation.path },
        ))
      }
    }
  }

  for (const node of workflow.nodes) {
    if (node.type !== "http-request" || Object.keys(node.config?.extractors ?? {}).length === 0) continue
    if (!resultsByNode.has(node.nodeId)) {
      diagnostics.push(diagnostic(
        "extractor_producer_not_executed",
        "warning",
        "dataflow",
        [node.nodeId],
        "An extractor producer did not execute in the selected run.",
        { variableNames: Object.keys(node.config?.extractors ?? {}).sort() },
        { kind: "inspect_upstream_branch", nodeId: node.nodeId },
      ))
    }
  }

  const resolvedSecretNames = new Set((run.resolvedSecrets ?? []).map((secret) => secret.name))
  for (const name of collectSecretReferenceNames(workflow.nodes)) {
    if (!resolvedSecretNames.has(name)) {
      diagnostics.push(diagnostic(
        "secret_resolution_metadata_missing",
        "notice",
        "security",
        [],
        "A configured secret reference has no resolution metadata in the selected run.",
        { name },
        { kind: "rerun_or_review_secret_reference" },
        "medium",
      ))
    }
  }
  for (const secret of run.resolvedSecrets ?? []) {
    if (!secret.resolved) {
      diagnostics.push(diagnostic(
        "secret_reference_unresolved",
        "error",
        "security",
        [],
        "A secret reference could not be resolved for the selected run.",
        { name: secret.name, scopeType: secret.scopeType, resolved: false },
        { kind: "define_secret_reference" },
      ))
    }
  }

  if (["completed", "failed", "cancelled", "interrupted"].includes(run.status)) {
    const pending = workflow.nodes
      .filter((node) => node.type !== "start")
      .filter((node) => {
        const status = run.nodeStatuses[node.nodeId]
        const result = resultsByNode.get(node.nodeId)
        if (result?.status === "skipped") return true
        if (result !== undefined) return false
        if (!isRecord(status)) return true
        return ["pending", "skipped"].includes(String(status["status"]))
      })
      .map((node) => node.nodeId)
      .sort()
    if (pending.length > 0) {
      diagnostics.push(diagnostic(
        "nodes_not_executed",
        "notice",
        "execution",
        pending,
        "Some nodes remained pending or were skipped after an upstream branch stopped.",
        { count: pending.length },
        { kind: "inspect_upstream_branch" },
        "medium",
      ))
    }
  }
}

/**
 * Deterministic, value-free diagnosis over a persisted workflow and optional stored run.
 *
 * Accepts the lightweight {@link WorkflowGraphInput} shape so the renderer canvas run
 * gate can reuse the *same* validator `workflow_diagnose`, `assertion_validate` and
 * `assertion_apply` honour — there is now one diagnosis path instead of two that can
 * disagree (a real run was blocked for `expectedValue: false` while `assertion_validate`
 * accepted it, because the gate ran a truthiness check rather than a presence check).
 */
export function analyzeWorkflowGraph(workflow: WorkflowGraphInput, run?: Run): WorkflowDiagnosis {
  const diagnostics: WorkflowDiagnostic[] = []
  addTopologyDiagnostics(workflow, diagnostics)
  addAssertionAndBranchDiagnostics(workflow, diagnostics)
  addDataflowDiagnostics(workflow, diagnostics)
  if (run !== undefined) addRunDiagnostics(workflow, run, diagnostics)

  diagnostics.sort((left, right) =>
    SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
      || compareText(left.code, right.code)
      || compareText(left.nodeIds.join("\u0000"), right.nodeIds.join("\u0000")),
  )
  return {
    workflowId: workflow.workflowId ?? "",
    ...(run === undefined ? {} : { runId: run.runId }),
    summary: {
      errors: diagnostics.filter((item) => item.severity === "error").length,
      warnings: diagnostics.filter((item) => item.severity === "warning").length,
      notices: diagnostics.filter((item) => item.severity === "notice").length,
    },
    diagnostics,
  }
}
