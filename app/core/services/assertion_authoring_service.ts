import type { AssertionApplyResult } from "@shared/types/AssertionApplyResult"
import type { AssertionItem } from "@shared/types/AssertionItem"
import type { AssertionSuggestionResult } from "@shared/types/AssertionSuggestionResult"
import type { AssertionValidationResult } from "@shared/types/AssertionValidationResult"
import type { JsonValue } from "@shared/types/JsonValue"
import type { Run } from "@shared/types/Run"
import type { RunResult } from "@shared/types/RunResult"
import type { Workflow } from "@shared/types/Workflow"
import { AssertionItemSchema } from "@shared/zod-schemas/AssertionItemSchema"
import { isValidRuntimePath } from "@shared/analysis/workflow_graph_analyzer"
import { NotFoundError, ValidationError } from "../ipc/errors"
import { isSecretKey, looksLikeSecretValue } from "./secret_utils"
import type { RunService } from "./run_service"
import type { WorkflowService } from "./workflow_service"

type ValidationIssue = AssertionValidationResult["issues"][number]
type Suggestion = AssertionSuggestionResult["suggestions"][number]

/** Spelled out rather than "invalid path" — the accepted shapes are not
 *  guessable, and a bare field name (`id`) is the common first attempt. */
export const PREV_PATH_MESSAGE =
  'A prev path addresses the upstream response object: "response.body.<field>" (dots and [0] indexes, e.g. response.body.data[0].id), "response.headers.<name>", "response.statusCode" or "response.duration". A bare field name like "id" is not a path — write "response.body.id". Use the status, headers or variables source instead of prev when asserting on those directly.'

export class AssertionAuthoringService {
  public constructor(
    private readonly workflows: WorkflowService,
    private readonly runs: RunService,
  ) {}

  async suggest(
    workspaceId: string,
    workflowId: string,
    runId: string,
    sourceNodeId: string,
  ): Promise<AssertionSuggestionResult> {
    const { run, sourceResult } = await this.getEvidence(workspaceId, workflowId, runId, sourceNodeId)
    if (sourceResult === undefined) {
      throw new NotFoundError(`result for node ${sourceNodeId} not found`)
    }

    const suggestions: Suggestion[] = []
    const response = asRecord(sourceResult.response)
    const statusCode = response?.["statusCode"]
    if (typeof statusCode === "number") {
      suggestions.push({
        id: "status-observed",
        title: `Require status ${statusCode}`,
        confidence: "high",
        rationale: `The selected request completed with status ${statusCode}.`,
        overfitRisk: "low",
        rules: canonicalRules([{ source: "status", path: "", operator: "equals", expectedValue: statusCode }]),
      })
      if (statusCode >= 200 && statusCode < 300) {
        suggestions.push({
          id: "status-success-range",
          title: "Require a successful status",
          confidence: "high",
          rationale: "The selected request completed in the successful HTTP status range.",
          overfitRisk: "low",
          rules: canonicalRules([
            { source: "status", path: "", operator: "gte", expectedValue: 200 },
            { source: "status", path: "", operator: "lt", expectedValue: 300 },
          ]),
        })
      }
    }

    const headers = asRecord(response?.["headers"])
    const contentType = findHeader(headers, "content-type")?.split(";", 1)[0]?.trim().toLowerCase()
    if (contentType) {
      suggestions.push({
        id: "content-type-family",
        title: `Require ${contentType} content`,
        confidence: "high",
        rationale: `The selected response declared the ${contentType} media type.`,
        overfitRisk: "low",
        rules: canonicalRules([{ source: "headers", path: "content-type", operator: "contains", expectedValue: contentType }]),
      })
    }

    if (response?.["truncated"] !== true) {
      const body = response?.["body"]
      if (Array.isArray(body)) {
        suggestions.push(countSuggestion("response.body", body.length, "array"))
      } else {
        const bodyRecord = asRecord(body)
        if (bodyRecord) {
          for (const key of Object.keys(bodyRecord).filter(isPathSegment).sort().slice(0, 8)) {
            suggestions.push({
              id: `body-${slug(key)}-exists`,
              title: `Require response field ${key}`,
              confidence: "medium",
              rationale: `The selected JSON object contained the top-level ${key} field (${jsonType(bodyRecord[key])}).`,
              overfitRisk: "low",
              rules: canonicalRules([{ source: "prev", path: `response.body.${key}`, operator: "exists" }]),
            })
          }
          suggestions.push(countSuggestion("response.body", Object.keys(bodyRecord).length, "object"))
        }
      }
    }

    if (Number.isFinite(sourceResult.duration)) {
      const duration = Math.max(0, sourceResult.duration)
      const budget = (Math.floor(duration / 100) + 1) * 100
      suggestions.push({
        id: "response-time-budget",
        title: `Keep response time at or below ${budget} ms`,
        confidence: "medium",
        rationale: "The budget is rounded above the observed millisecond duration.",
        overfitRisk: "medium",
        rules: canonicalRules([{ source: "prev", path: "response.duration", operator: "lte", expectedValue: budget }]),
      })
    }

    return { workflowId, runId: run.runId, sourceNodeId, suggestions }
  }

  async validate(
    workspaceId: string,
    workflowId: string,
    sourceNodeId: string,
    drafts: readonly unknown[],
    runId?: string,
  ): Promise<AssertionValidationResult> {
    const workflow = await this.workflows.get(workspaceId, workflowId)
    requireHttpNode(workflow, sourceNodeId)

    let sourceResult: RunResult | undefined
    if (runId !== undefined) {
      const evidence = await this.getEvidence(workspaceId, workflowId, runId, sourceNodeId)
      sourceResult = evidence.sourceResult
    }

    const rules: AssertionItem[] = []
    const issues: ValidationIssue[] = []
    let compatible = true
    for (const [ruleIndex, draft] of drafts.entries()) {
      const parsed = AssertionItemSchema.safeParse(canonicalDraft(draft))
      if (!parsed.success) {
        issues.push({ ruleIndex, code: "invalid_rule", severity: "error", message: "Rule does not match the canonical assertion contract." })
        continue
      }

      const rule = parsed.data
      const ruleIssues = validateRule(rule, ruleIndex)
      issues.push(...ruleIssues)
      if (ruleIssues.some((issue) => issue.code === "unsafe_literal")) continue
      rules.push(rule)

      if (sourceResult !== undefined) {
        const evidenceIssue = validateEvidencePath(rule, ruleIndex, sourceResult)
        if (evidenceIssue) {
          issues.push(evidenceIssue)
          compatible = false
        }
      } else if (runId !== undefined) {
        issues.push({
          ruleIndex,
          code: "source_result_missing",
          severity: "error",
          message: "The selected HTTP node has no result in this run.",
        })
        compatible = false
      }
    }

    const hasErrors = issues.some((issue) => issue.severity === "error")
    return {
      workflowId,
      sourceNodeId,
      ...(runId !== undefined ? { runId } : {}),
      valid: !hasErrors && rules.length === drafts.length,
      compatible,
      rules,
      issues,
      preview: hasErrors ? [] : rules.map(previewRule),
    }
  }

  async apply(
    workspaceId: string,
    workflowId: string,
    expectedRevision: number,
    assertionNodeId: string,
    mode: "append" | "replace",
    drafts: readonly unknown[],
  ): Promise<AssertionApplyResult> {
    const workflow = await this.workflows.get(workspaceId, workflowId)
    const sourceNodeId = resolveAssertionSource(workflow, assertionNodeId)
    const validation = await this.validate(workspaceId, workflowId, sourceNodeId, drafts)
    if (!validation.valid) {
      throw new ValidationError("assertion rules failed validation", validation.issues)
    }
    const updated = await this.workflows.applyAssertions(
      workspaceId,
      workflowId,
      expectedRevision,
      assertionNodeId,
      mode,
      validation.rules,
    )
    return { workflow: updated, revision: updated.rev }
  }

  private async getEvidence(
    workspaceId: string,
    workflowId: string,
    runId: string,
    sourceNodeId: string,
  ): Promise<{ readonly run: Run; readonly sourceResult: RunResult | undefined }> {
    const workflow = await this.workflows.get(workspaceId, workflowId)
    requireHttpNode(workflow, sourceNodeId)
    const run = await this.runs.get(workspaceId, runId)
    if (run.workflowId !== workflowId) throw new NotFoundError(`run ${runId} not found`)
    return { run, sourceResult: run.results.find((result) => result.nodeId === sourceNodeId) }
  }
}

function canonicalRules(rules: readonly AssertionItem[]): AssertionItem[] {
  return AssertionItemSchema.array().parse(rules)
}

function countSuggestion(path: string, count: number, kind: "array" | "object"): Suggestion {
  return {
    id: "body-count",
    title: `Require ${count} top-level ${kind === "array" ? "items" : "fields"}`,
    confidence: "low",
    rationale: `The selected response body was a ${kind} with a top-level count of ${count}.`,
    overfitRisk: "high",
    rules: canonicalRules([{ source: "prev", path, operator: "count", expectedValue: count }]),
  }
}

function requireHttpNode(workflow: Workflow, sourceNodeId: string): void {
  const node = workflow.nodes.find((candidate) => candidate.nodeId === sourceNodeId)
  if (!node || node.type !== "http-request") throw new NotFoundError(`HTTP node ${sourceNodeId} not found`)
}

function resolveAssertionSource(workflow: Workflow, assertionNodeId: string): string {
  const assertion = workflow.nodes.find((node) => node.nodeId === assertionNodeId)
  if (!assertion || assertion.type !== "assertion") {
    throw new ValidationError(`node ${assertionNodeId} is not an assertion node`)
  }

  const nodes = new Map(workflow.nodes.map((node) => [node.nodeId, node]))
  const queue = workflow.edges.filter((edge) => edge.target === assertionNodeId).map((edge) => edge.source)
  const visited = new Set<string>()
  const sources = new Set<string>()
  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined || visited.has(current)) continue
    visited.add(current)
    const node = nodes.get(current)
    if (node?.type === "http-request") {
      sources.add(current)
      continue
    }
    for (const edge of workflow.edges) if (edge.target === current) queue.push(edge.source)
  }
  if (sources.size !== 1) {
    throw new ValidationError(sources.size === 0
      ? "assertion node has no upstream HTTP source"
      : "assertion node has ambiguous upstream HTTP sources")
  }
  return [...sources][0]!
}

function canonicalDraft(value: unknown): unknown {
  const draft = asUnknownRecord(value)
  if (!draft) return value
  const source = draft["source"]
  const operator = draft["operator"]
  let path = typeof draft["path"] === "string" ? draft["path"].trim() : ""
  if (source === "status") path = ""
  // `prev` paths are stored `response.`-prefixed. The runner strips the prefix
  // before reading, so both forms run identically — canonicalize the bare form
  // (`body.id`, `statusCode`) rather than rejecting it, which is the shape an
  // agent naturally writes after reading a captured response.
  if (source === "prev" && path.length > 0 && !path.startsWith("response.")) {
    path = `response.${path}`
  }
  return {
    source,
    path,
    operator,
    ...(!["exists", "notExists"].includes(String(operator)) && "expectedValue" in draft
      ? { expectedValue: draft["expectedValue"] }
      : {}),
  }
}

const NUMERIC_OPERATORS: readonly string[] = ["equals", "notEquals", "gt", "gte", "lt", "lte"]
const NAMED_PATH_SOURCES: readonly string[] = ["variables", "headers", "cookies"]
const NAMED_PATH_EXAMPLES: Readonly<Record<string, string>> = {
  variables: 'the workflow variable name, with no response. prefix (for example "token")',
  headers: 'the header name, with no response. prefix (for example "content-type")',
  cookies: 'the cookie name, with no response. prefix (for example "session")',
}

/** Each check answers "what is wrong with this rule", or undefined when nothing is. */
const RULE_CHECKS: readonly ((rule: AssertionItem) => Omit<ValidationIssue, "ruleIndex"> | undefined)[] = [
  (rule) =>
    rule.operator !== "exists" && rule.operator !== "notExists" && rule.expectedValue === undefined
      ? { code: "expected_required", severity: "error", message: "This operator requires an expected value." }
      : undefined,
  // Same predicate `workflow_diagnose` uses, so a rule this accepts never trips
  // `assertion_source_path_invalid` later (and vice versa).
  (rule) =>
    rule.source === "prev" && !isValidRuntimePath(rule.path, true)
      ? { code: "invalid_path", severity: "error", message: PREV_PATH_MESSAGE }
      : undefined,
  (rule) =>
    NAMED_PATH_SOURCES.includes(rule.source) && rule.path.length === 0
      ? {
          code: "path_required",
          severity: "error",
          message: `Source ${rule.source} requires a path: ${NAMED_PATH_EXAMPLES[rule.source] ?? "the name"}.`,
        }
      : undefined,
  (rule) =>
    rule.source === "status" && !NUMERIC_OPERATORS.includes(rule.operator)
      ? {
          code: "invalid_operator",
          severity: "error",
          message: "Status assertions require a numeric comparison operator: equals, notEquals, gt, gte, lt or lte.",
        }
      : undefined,
  (rule) =>
    rule.operator === "count" && (!Number.isInteger(rule.expectedValue) || Number(rule.expectedValue) < 0)
      ? { code: "invalid_count", severity: "error", message: "Count assertions require a non-negative integer." }
      : undefined,
  (rule) =>
    isUnsafeLiteral(rule)
      ? {
          code: "unsafe_literal",
          severity: "error",
          message: "Secret-looking literals are not accepted; use a {{secrets.NAME}} reference.",
        }
      : undefined,
]

/** A credential pasted into `expectedValue` — either the leaf name or the value itself gives it away. */
function isUnsafeLiteral(rule: AssertionItem): boolean {
  const expected = rule.expectedValue
  if (typeof expected !== "string" || isSecretReference(expected)) return false
  const leaf = rule.path.split(".").at(-1) ?? ""
  return isSecretKey(leaf) || looksLikeSecretValue(expected)
}

function validateRule(rule: AssertionItem, ruleIndex: number): ValidationIssue[] {
  return RULE_CHECKS.flatMap((check) => {
    const issue = check(rule)
    return issue === undefined ? [] : [{ ruleIndex, ...issue }]
  })
}

function validateEvidencePath(rule: AssertionItem, ruleIndex: number, result: RunResult): ValidationIssue | undefined {
  const response = asRecord(result.response)
  if (rule.source === "variables") return undefined
  if (rule.source === "status") {
    return typeof response?.["statusCode"] === "number" ? undefined : missingPath(ruleIndex)
  }
  if (rule.source === "headers") {
    return findHeader(asRecord(response?.["headers"]), rule.path) !== undefined ? undefined : missingPath(ruleIndex)
  }
  if (rule.source === "cookies") {
    const setCookie = findHeader(asRecord(response?.["headers"]), "set-cookie")
    return setCookie?.toLowerCase().includes(`${rule.path.toLowerCase()}=`) ? undefined : missingPath(ruleIndex)
  }
  if (rule.path === "response.duration") return Number.isFinite(result.duration) ? undefined : missingPath(ruleIndex)
  if (response?.["truncated"] === true) {
    return { ruleIndex, code: "response_truncated", severity: "warning", message: "Body-path compatibility is unavailable because the response was truncated." }
  }
  const relative = rule.path.replace(/^response\./, "")
  return nestedValue(response, relative).found ? undefined : missingPath(ruleIndex)
}

function missingPath(ruleIndex: number): ValidationIssue {
  return { ruleIndex, code: "path_missing", severity: "error", message: "The target path was not present in the selected run evidence." }
}

function previewRule(rule: AssertionItem): string {
  const target = rule.source === "status" ? "HTTP status" : `${rule.source} ${rule.path}`
  if (rule.operator === "exists" || rule.operator === "notExists") return `${target} ${rule.operator}`
  return `${target} ${rule.operator} ${JSON.stringify(rule.expectedValue)}`
}

function asUnknownRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function asRecord(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : undefined
}

function findHeader(headers: Record<string, JsonValue> | undefined, name: string): string | undefined {
  if (!headers) return undefined
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())
  return typeof entry?.[1] === "string" ? entry[1] : undefined
}

function nestedValue(value: JsonValue | undefined, path: string): { readonly found: boolean } {
  let current: JsonValue | undefined = value
  for (const segment of path.split(".").filter(Boolean)) {
    const record = asRecord(current)
    if (!record || !(segment in record)) return { found: false }
    current = record[segment]
  }
  return { found: current !== undefined }
}

function isSecretReference(value: string): boolean {
  return /^\{\{secrets\.[A-Za-z_][A-Za-z0-9_]*\}\}$/.test(value)
}

function isPathSegment(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value)
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

function jsonType(value: JsonValue | undefined): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value === "object" ? "object" : typeof value
}
