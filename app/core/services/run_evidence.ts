import { resolveExtractorPath } from "@shared/extractors/extractorPath"
import type { JsonValue } from "@shared/types/JsonValue"
import type { NodeEvidence } from "@shared/types/NodeEvidence"
import type { NodeEvidencePage } from "@shared/types/NodeEvidencePage"
import type { Run } from "@shared/types/Run"
import type { RunResult } from "@shared/types/RunResult"
import type { RunHistoryCursor } from "../repositories/RunRepository"
import { EVIDENCE_PREVIEW_DEFAULT_BYTES, INLINE_RESULT_BUDGET_BYTES } from "./read_budgets"
import { sanitizeAgentReadValue } from "./secret_utils"
import { ConflictError, ValidationError } from "../ipc/errors"
import { openCursor, sealCursor } from "../ipc/opaque_cursor"

/* ------------------------------------------------------------------------- *
 * Run-history cursors: opaque, filter-bound, revision-safe.
 * ------------------------------------------------------------------------- */

export interface SealedHistoryCursor {
  readonly after: RunHistoryCursor
}

export function sealHistoryCursor(args: {
  readonly workspaceId: string
  readonly workflowId?: string | undefined
  readonly status?: Run["status"] | undefined
  readonly limit: number
  readonly after: RunHistoryCursor
  readonly snapshot: string
}): string {  return sealCursor({
    v: 1,
    kind: "run-history",
    workspaceId: args.workspaceId,
    ...(args.workflowId !== undefined ? { workflowId: args.workflowId } : {}),
    ...(args.status !== undefined ? { status: args.status } : {}),
    limit: args.limit,
    after: { createdAt: args.after.createdAt, runId: args.after.runId },
    snapshot: args.snapshot,
  })
}

export function openHistoryCursor(
  cursor: string,
  request: { readonly workspaceId: string; readonly workflowId: string | undefined; readonly status: Run["status"] | undefined },
  snapshot: string,
): SealedHistoryCursor {
  const payload = openCursor(cursor)
  if (payload === undefined || payload["v"] !== 1 || payload["kind"] !== "run-history") {
    throw new ValidationError("This cursor is not valid; call again without a cursor to start from the first page.")
  }
  if (payload["workspaceId"] !== request.workspaceId) {
    throw new ValidationError("This cursor belongs to another workspace; call again without a cursor.")
  }
  const workflowId = typeof payload["workflowId"] === "string" ? payload["workflowId"] : undefined
  const status = typeof payload["status"] === "string" ? payload["status"] : undefined
  if (workflowId !== request.workflowId || status !== request.status) {
    throw new ValidationError("This cursor was issued for different filters; call again without a cursor.")
  }
  if (payload["snapshot"] !== snapshot) {
    throw new ConflictError("The run history changed since this cursor was issued; call again without a cursor.")
  }
  const after = payload["after"]
  if (
    typeof after !== "object" || after === null
    || typeof (after as { createdAt?: unknown }).createdAt !== "string"
    || typeof (after as { runId?: unknown }).runId !== "string"
  ) {
    throw new ValidationError("This cursor is not valid; call again without a cursor to start from the first page.")
  }
  return { after: { createdAt: (after as { createdAt: string }).createdAt, runId: (after as { runId: string }).runId } }
}

/* ------------------------------------------------------------------------- *
 * Targeted node evidence over one authorized run snapshot.
 * ------------------------------------------------------------------------- */

export const EVIDENCE_SECTIONS = ["error", "assertions", "extractors", "request", "response"] as const

export type EvidenceSection = (typeof EVIDENCE_SECTIONS)[number]

export interface EvidenceSelection {
  readonly nodeIds: readonly string[]
  readonly sections?: readonly EvidenceSection[]
  readonly path?: string
  readonly maxBytes?: number
  readonly start?: number
  readonly end?: number
}

export interface EvidenceBounds {
  readonly maxBytes: number
  readonly start?: number
  readonly end?: number
}

const ALL_SECTIONS: readonly EvidenceSection[] = EVIDENCE_SECTIONS

/**
 * Build bounded evidence for a small node set. Selection runs here — before
 * the router's redaction pass — so masking keeps its original body, header
 * and URL context instead of selecting from an already-flattened shape.
 * Bodies are previewed, never echoed whole: every preview states its total
 * size and whether it was cut.
 */
export function buildNodeEvidencePage(run: Run, selection: EvidenceSelection): NodeEvidencePage {
  const wanted = new Set(selection.sections ?? ALL_SECTIONS)
  const maxBytes = selection.maxBytes ?? EVIDENCE_PREVIEW_DEFAULT_BYTES
  const results = new Map(run.results.map((result) => [result.nodeId, result]))
  const items: NodeEvidence[] = []
  const missingNodeIds: string[] = []
  for (const nodeId of selection.nodeIds) {
    const result = results.get(nodeId)
    if (result === undefined) {
      missingNodeIds.push(nodeId)
      continue
    }
    items.push(buildNodeEvidence(result, wanted, {
      maxBytes,
      ...(selection.path !== undefined ? { path: selection.path } : {}),
      ...(selection.start !== undefined ? { start: selection.start } : {}),
      ...(selection.end !== undefined ? { end: selection.end } : {}),
    }))
  }
  const omittedSections = ALL_SECTIONS.filter((section) => !wanted.has(section))
  const withOmissions: NodeEvidence[] = items.map((item) => ({ ...item, omittedSections: [...item.omittedSections, ...omittedSections] }))
  return applyEvidenceBudget({
    runId: run.runId,
    workflowId: run.workflowId,
    runStatus: run.status,
    items: withOmissions,
    missingNodeIds: [...missingNodeIds].sort(),
    budgetLimitBytes: INLINE_RESULT_BUDGET_BYTES,
  })
}

function buildNodeEvidence(
  result: RunResult,
  wanted: ReadonlySet<EvidenceSection>,
  bounds: EvidenceBounds & { path?: string },
): NodeEvidence {
  const base = {
    nodeId: result.nodeId,
    status: result.status,
    durationMs: result.duration,
    ...(result.startedAt !== undefined ? { startedAt: result.startedAt } : {}),
    ...(result.completedAt !== undefined ? { completedAt: result.completedAt } : {}),
    ...(result.expectedStatus !== undefined ? { expectedStatus: result.expectedStatus } : {}),
    secretRefs: result.secretRefs ? [...result.secretRefs] : [],
    unresolvedPlaceholders: result.unresolvedPlaceholders ? [...result.unresolvedPlaceholders] : [],
    hasError: typeof result.error === "string" && result.error.length > 0,
  }
  return {
    ...base,
    ...(wanted.has("error") && result.error !== undefined && result.error !== null ? { error: result.error } : {}),
    ...(wanted.has("assertions") && result.assertions !== undefined ? { assertions: result.assertions } : {}),
    ...(wanted.has("extractors") && result.extractorOutcomes !== undefined ? { extractorOutcomes: [...result.extractorOutcomes] } : {}),
    ...(wanted.has("request") ? { request: buildRequestEvidence(result.request, bounds) } : {}),
    ...(wanted.has("response") ? { response: buildResponseEvidence(result.response, bounds) } : {}),
    omittedSections: [],
    budgetOmitted: false,
  }
}

function buildRequestEvidence(
  request: JsonValue | null | undefined,
  bounds: EvidenceBounds,
): NonNullable<NodeEvidence["request"]> {
  const record = isRecord(request) ? request : null
  const method = typeof record?.["method"] === "string" ? record["method"] : null
  const url = typeof record?.["url"] === "string" ? record["url"] : null
  const body = record?.["body"]
  if (body === undefined) return { method, url }
  // Redact while the body is still structured: serializing first would turn
  // the payload into one opaque string the key-aware redactor cannot walk.
  const preview = previewValue(redactBody(body), bounds)
  return {
    method,
    url,
    ...(preview.preview !== undefined ? { preview: preview.preview } : {}),
    ...(preview.previewTruncated !== undefined ? { previewTruncated: preview.previewTruncated } : {}),
    ...(preview.totalBytes !== undefined ? { totalBytes: preview.totalBytes } : {}),
  }
}

function buildResponseEvidence(
  response: JsonValue | null | undefined,
  bounds: EvidenceBounds & { path?: string },
): NonNullable<NodeEvidence["response"]> {
  const record = isRecord(response) ? response : null
  const statusCode = typeof record?.["statusCode"] === "number" ? record["statusCode"] : null
  const storedTruncated = record?.["truncated"] === true
  const body = record !== null && "body" in record ? record["body"] as JsonValue : (response ?? undefined)
  if (body === undefined) return { statusCode, storedTruncated }
  const redacted = redactBody(body)
  if (bounds.path !== undefined) {
    // Paths stay rooted at `response.` (the extractor grammar agents know),
    // resolved against the redacted record so a withheld leaf selects as
    // `<SECRET>` rather than leaking.
    const scope = record !== null ? { ...record, body: redacted } : redacted
    const selected = selectResponsePath(scope, bounds.path)
    if (selected.found) {
      const preview = previewSelected(selected.value, bounds)
      return {
        statusCode,
        storedTruncated,
        pathStatus: "resolved" as const,
        ...(preview.preview !== undefined ? { preview: preview.preview } : {}),
        ...(preview.previewTruncated !== undefined ? { previewTruncated: preview.previewTruncated } : {}),
        ...(preview.totalBytes !== undefined ? { totalBytes: preview.totalBytes } : {}),
      }
    }
    return { statusCode, storedTruncated, pathStatus: selected.reason }
  }
  const preview = previewValue(redacted, bounds)
  return {
    statusCode,
    storedTruncated,
    ...(preview.preview !== undefined ? { preview: preview.preview } : {}),
    ...(preview.previewTruncated !== undefined ? { previewTruncated: preview.previewTruncated } : {}),
    ...(preview.totalBytes !== undefined ? { totalBytes: preview.totalBytes } : {}),
  }
}

/**
 * Withhold credential leaves while the body is still structured, before any
 * path selection or preview serialization. Uses the same agent-read pass the
 * transport applies, so a key the transport would mask (`password`,
 * `Authorization`, a bearer token) is already `<SECRET>` here — selecting or
 * previewing first would either leak it or lose the masking context.
 */
function redactBody(body: JsonValue): JsonValue {
  return sanitizeAgentReadValue(body)
}

/**
 * Resolve `path` with the project's authoritative extractor grammar — the
 * same `response.body.items[0].id` language extractors and assertion paths
 * use — so evidence selection agrees with the runner about what a path
 * addresses. Deterministic: no evaluation, no queries.
 */
function selectResponsePath(
  scope: JsonValue,
  path: string,
): { found: true; value: unknown } | { found: false; reason: "path-missing" | "type-mismatch" } {
  const resolution = resolveExtractorPath({ response: scope }, path)
  if (resolution.failureReason !== null) {
    return { found: false, reason: resolution.failureReason }
  }
  return { found: true, value: resolution.value }
}

/**
 * Serialize a path-selected value. Unlike whole-body previews (where a text
 * body stays raw text), a selection is always JSON-encoded so a string reads
 * quoted and unambiguous next to the objects around it.
 */
function previewSelected(
  value: unknown,
  bounds: EvidenceBounds,
): { preview?: string; previewTruncated?: boolean; totalBytes?: number } {
  const text = JSON.stringify(value) ?? "null"
  return previewText(text, bounds)
}

/** Serialize a body to a bounded text preview with explicit cut accounting. */
function previewValue(
  body: JsonValue,
  bounds: EvidenceBounds,
): { preview?: string; previewTruncated?: boolean; totalBytes?: number } {
  const text = typeof body === "string" ? body : JSON.stringify(body)
  if (text === undefined) return {}
  return previewText(text, bounds)
}

function previewText(
  text: string,
  bounds: EvidenceBounds,
): { preview: string; previewTruncated: boolean; totalBytes: number } {
  const totalBytes = Buffer.byteLength(text, "utf8")
  const start = bounds.start ?? 0
  const window = bounds.end === undefined ? text.slice(start) : text.slice(start, bounds.end)
  const preview = window.slice(0, bounds.maxBytes)
  const windowCut = start > 0 || (bounds.end !== undefined && bounds.end < text.length)
  return { preview, previewTruncated: windowCut || preview.length < window.length, totalBytes }
}

interface BudgetInput {
  readonly runId: string
  readonly workflowId: string
  readonly runStatus: Run["status"]
  readonly items: readonly NodeEvidence[]
  readonly missingNodeIds: readonly string[]
  readonly budgetLimitBytes: number
}
/**
 * Hold the page to the aggregate inline budget. Over-budget pages drop body
 * previews largest-first and mark those entries `budgetOmitted` with a stated
 * selector (refetch the node alone) — metadata and counts always survive.
 */
function applyEvidenceBudget(page: BudgetInput): NodeEvidencePage {
  const items = page.items.map((item) => ({ ...item }))
  const missingNodeIds = [...page.missingNodeIds]
  const withoutBudget: NodeEvidencePage = {
    runId: page.runId,
    workflowId: page.workflowId,
    runStatus: page.runStatus,
    items,
    missingNodeIds,
    omittedBodyCount: 0,
    budgetBytes: Buffer.byteLength(JSON.stringify(items), "utf8"),
    budgetLimitBytes: page.budgetLimitBytes,
  }
  if (withoutBudget.budgetBytes <= page.budgetLimitBytes) return withoutBudget
  const sizes = page.items.map((item, index) => ({
    index,
    bytes: Buffer.byteLength(JSON.stringify(item.request?.preview ?? ""), "utf8")
      + Buffer.byteLength(JSON.stringify(item.response?.preview ?? ""), "utf8"),
  })).sort((left, right) => right.bytes - left.bytes)
  let omittedBodyCount = 0
  let budgetBytes = withoutBudget.budgetBytes
  for (const { index, bytes } of sizes) {
    if (budgetBytes <= page.budgetLimitBytes || bytes === 0) break
    const item = items[index]!
    const hadRequestPreview = item.request?.preview !== undefined
    const hadResponsePreview = item.response?.preview !== undefined
    const freed = Buffer.byteLength(JSON.stringify(hadRequestPreview ? item.request?.preview : ""), "utf8")
      + Buffer.byteLength(JSON.stringify(hadResponsePreview ? item.response?.preview : ""), "utf8")
    const request = item.request === undefined ? undefined : dropRequestPreview(item.request)
    const response = item.response === undefined ? undefined : dropResponsePreview(item.response)
    items[index] = {
      ...item,
      ...(request === undefined ? {} : { request }),
      ...(response === undefined ? {} : { response }),
      budgetOmitted: true,
    }
    omittedBodyCount += (hadRequestPreview ? 1 : 0) + (hadResponsePreview ? 1 : 0)
    budgetBytes -= freed
  }
  return {
    runId: page.runId,
    workflowId: page.workflowId,
    runStatus: page.runStatus,
    items,
    missingNodeIds,
    omittedBodyCount,
    budgetBytes,
    budgetLimitBytes: page.budgetLimitBytes,
  }
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Copy a request section without its body preview key. */
function dropRequestPreview(section: NonNullable<NodeEvidence["request"]>): NonNullable<NodeEvidence["request"]> {
  const rest = { ...section }
  delete rest.preview
  return rest
}

/** Copy a response section without its body preview key. */
function dropResponsePreview(section: NonNullable<NodeEvidence["response"]>): NonNullable<NodeEvidence["response"]> {
  const rest = { ...section }
  delete rest.preview
  return rest
}
