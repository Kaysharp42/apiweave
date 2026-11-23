import { resolveExtractorPath } from "@shared/extractors/extractorPath"
import type { AriaScope } from "@shared/types/AriaScope"
import type { JsonValue } from "@shared/types/JsonValue"
import type { NodeEvidence } from "@shared/types/NodeEvidence"
import type { NodeEvidencePage } from "@shared/types/NodeEvidencePage"
import type { Run } from "@shared/types/Run"
import type { RunResult } from "@shared/types/RunResult"
import type { RunHistoryCursor } from "../repositories/RunRepository"
import { EVIDENCE_PREVIEW_DEFAULT_BYTES, INLINE_RESULT_BUDGET_BYTES, CALL_EVIDENCE_MAX_ITERATIONS, truncateUtf8, truncateUtf8Marked } from "./read_budgets"
import { scopeAriaSnapshot } from "./aria_scope"
import { sanitizeAgentReadValue } from "./secret_utils"
import { assertCursorSnapshot, cursorScope, openKeysetCursor, sealCursor } from "../ipc/opaque_cursor"

/* ------------------------------------------------------------------------- *
 * Run-history cursors: opaque, filter-bound, revision-safe.
 * ------------------------------------------------------------------------- */

export interface SealedHistoryCursor {
  readonly after: RunHistoryCursor
}

function historyScope(request: { readonly workspaceId: string; readonly workflowId?: string | undefined; readonly status?: Run["status"] | undefined }): string {
  return cursorScope({ workspaceId: request.workspaceId, workflowId: request.workflowId ?? null, status: request.status ?? null })
}

export function sealHistoryCursor(args: {
  readonly workspaceId: string
  readonly workflowId?: string | undefined
  readonly status?: Run["status"] | undefined
  readonly after: RunHistoryCursor
  readonly snapshot: string
}): string {
  return sealCursor("h", {
    scope: historyScope(args),
    snapshot: cursorScope(args.snapshot),
    position: [args.after.createdAt, args.after.runId],
  })
}

export function openHistoryCursor(
  cursor: string,
  request: { readonly workspaceId: string; readonly workflowId: string | undefined; readonly status: Run["status"] | undefined },
  snapshot: string,
): SealedHistoryCursor {
  const opened = openKeysetCursor(cursor, "h", {
    scope: historyScope(request),
    scopeMessage: "This cursor was issued for a different workspace or different filters; call again without a cursor.",
  })
  assertCursorSnapshot(opened.snapshot, snapshot, "The run history changed since this cursor was issued; call again without a cursor.")
  const [createdAt, runId] = opened.position
  return { after: { createdAt, runId } }
}

/* ------------------------------------------------------------------------- *
 * Targeted node evidence over one authorized run snapshot.
 * ------------------------------------------------------------------------- */

export const EVIDENCE_SECTIONS = ["error", "assertions", "extractors", "request", "response", "browser", "call"] as const

export type EvidenceSection = (typeof EVIDENCE_SECTIONS)[number]

export interface EvidenceSelection {
  readonly nodeIds: readonly string[]
  readonly sections?: readonly EvidenceSection[]
  readonly path?: string
  readonly maxBytes?: number
  /** Which part of a browser step's ARIA snapshot to return; default "auto" (dialog, else main, else page). */
  readonly scope?: AriaScope
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
 * Bodies and a browser step's ARIA snapshot are previewed, never echoed whole:
 * every preview states its total size and whether it was cut.
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
    // The selection's path, scope and window are already exact optionals; only maxBytes gets its default.
    items.push(buildNodeEvidence(result, wanted, { ...selection, maxBytes }))
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

// fallow-ignore-next-line complexity
function buildNodeEvidence(
  result: RunResult,
  wanted: ReadonlySet<EvidenceSection>,
  bounds: EvidenceBounds & { path?: string; scope?: AriaScope },
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
    ...(wanted.has("browser") && result.browser !== undefined ? { browser: buildBrowserEvidence(result.browser, bounds) } : {}),
    ...(wanted.has("call") && result.subWorkflow !== undefined ? { call: callEvidenceSummary(result.subWorkflow) } : {}),
    omittedSections: [],
    budgetOmitted: false,
  }
}

/**
 * A Call Workflow node's child-run summary, as an agent reads it: the target,
 * the child run id to follow the failure into, and — for a for-each call —
 * each iteration's run id and status in item order. A for-each may run a
 * thousand iterations, so the rows are capped; the cap keeps every
 * failed/cancelled iteration first (they are the ones worth opening) and fills
 * the rest with passed ones, counting what it left out in
 * `omittedIterationCount`. Shared by the node-evidence read and the
 * debug-context summary so the two agree on a call.
 */
export function callEvidenceSummary(
  sub: NonNullable<RunResult["subWorkflow"]>,
): NonNullable<NodeEvidence["call"]> {
  return {
    workflowId: sub.workflowId,
    ...(sub.runId !== undefined ? { runId: sub.runId } : {}),
    status: sub.status,
    nodeCount: sub.nodeCount,
    failedNodeCount: sub.failedNodeCount,
    ...(sub.forEach === undefined ? {} : {
      forEach: {
        itemCount: sub.forEach.itemCount,
        ranCount: sub.forEach.ranCount,
        failedCount: sub.forEach.failedCount,
        iterations: boundedIterations(sub.forEach),
        omittedIterationCount: Math.max(0, sub.forEach.iterations.length - CALL_EVIDENCE_MAX_ITERATIONS),
      },
    }),
  }
}

/** The iteration rows `callEvidenceSummary` carries: non-passing rows first, then passed ones, back in item order. */
type CallIterationRow = NonNullable<NonNullable<NonNullable<NodeEvidence["call"]>["forEach"]>["iterations"][number]>

function boundedIterations(
  forEach: NonNullable<NonNullable<RunResult["subWorkflow"]>["forEach"]>,
): CallIterationRow[] {
  const rows = forEach.iterations
  const keep = [...rows.filter((row) => row.status !== "passed"), ...rows.filter((row) => row.status === "passed")]
    .slice(0, CALL_EVIDENCE_MAX_ITERATIONS)
    .sort((left, right) => left.index - right.index)
  return keep.map((iteration) => ({
    index: iteration.index,
    ...(iteration.runId !== undefined ? { runId: iteration.runId } : {}),
    status: iteration.status,
  }))
}

// fallow-ignore-next-line complexity
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
    ...preview,
  }
}

// fallow-ignore-next-line complexity
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
        ...preview,
      }
    }
    return { statusCode, storedTruncated, pathStatus: selected.reason }
  }
  const preview = previewValue(redacted, bounds)
  return {
    statusCode,
    storedTruncated,
    ...preview,
  }
}

/**
 * The identity and compared text of a browser step, shared by the node-evidence
 * read and the debug-context summary: both cut page text to their own byte
 * budget and carry the same fields, so the two reads agree on a step.
 */
export function browserEvidenceSummary(
  browser: NonNullable<RunResult["browser"]>,
  maxTextBytes: number,
): {
  action: string
  url?: string
  title?: string
  expected?: string
  actual?: string
} {
  return {
    action: browser.action,
    ...(browser.url !== undefined ? { url: browser.url } : {}),
    ...(browser.title !== undefined ? { title: browser.title } : {}),
    ...(browser.expected !== undefined ? { expected: truncateUtf8Marked(browser.expected, maxTextBytes) } : {}),
    ...(browser.actual !== undefined ? { actual: truncateUtf8Marked(browser.actual, maxTextBytes) } : {}),
  }
}

/**
 * One browser step's stored evidence, as an agent reads it. The ARIA snapshot
 * goes through the same bounded, windowable text preview a response body does
 * (a whole snapshot is up to 64 KiB, most of a page budget, and an agent
 * repairing a locator usually needs a slice, not the document) — scoped first,
 * so the preview and its byte window address the dialog or main content the
 * locator lives in rather than the navigation chrome that opens every
 * snapshot. `expected` and `actual` are page text too, so they are cut to the
 * caller's preview cap with a visible marker rather than arriving whole. The
 * screenshot is reported as a presence flag: its artifact id is a transport
 * detail (the bytes are read through a different, capped route), never part
 * of this read.
 */
function buildBrowserEvidence(
  browser: NonNullable<RunResult["browser"]>,
  bounds: EvidenceBounds & { scope?: AriaScope },
): NonNullable<NodeEvidence["browser"]> {
  return {
    ...browserEvidenceSummary(browser, bounds.maxBytes),
    ...(browser.detail !== undefined ? { detail: truncateUtf8Marked(browser.detail, bounds.maxBytes) } : {}),
    ...(browser.evidenceNote !== undefined ? { evidenceNote: browser.evidenceNote } : {}),
    hasScreenshot: browser.screenshotArtifactId !== undefined,
    ...(browser.ariaSnapshot !== undefined ? { ariaSnapshot: snapshotPreview(browser.ariaSnapshot, bounds) } : {}),
  }
}

function snapshotPreview(
  snapshot: string,
  bounds: EvidenceBounds & { scope?: AriaScope },
): NonNullable<NonNullable<NodeEvidence["browser"]>["ariaSnapshot"]> {
  // Scope the stored (already masked) text, then window the scoped text: the
  // preview and its offsets address what was actually returned, and masking
  // still ran on the full text before any of it reached here.
  const scoped = scopeAriaSnapshot(snapshot, bounds.scope ?? "auto")
  const preview = previewText(scoped.text, bounds)
  return {
    preview: preview.preview,
    previewTruncated: preview.previewTruncated,
    totalBytes: preview.totalBytes,
    scope: scoped.applied,
    ...(scoped.note !== undefined ? { scopeNote: scoped.note } : {}),
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
): { found: true; value: unknown } | { found: false; reason: "path-missing" | "type-mismatch" | "invalid-path" } {
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
  return previewFields(previewText(text, bounds))
}

/** Serialize a body to a bounded text preview with explicit cut accounting. */
function previewValue(
  body: JsonValue,
  bounds: EvidenceBounds,
): { preview?: string; previewTruncated?: boolean; totalBytes?: number } {
  const text = typeof body === "string" ? body : JSON.stringify(body)
  if (text === undefined) return {}
  return previewFields(previewText(text, bounds))
}

/**
 * Serialize a value to a bounded text preview with explicit cut accounting.
 * Shared by the node-evidence read and the browser inspection read, so a
 * snapshot window means the same bytes in both.
 *
 * `previewTruncated` means the returned window is not the whole text — either
 * because the caller asked for `start`/`end` or because `maxBytes` cut it, which
 * is what the field has always stated. `maxBytesCut` isolates the second case:
 * a caller that says "cut at maxBytes" must key on it, or a window the caller
 * chose is described as a cap that never acted.
 */
export function previewText(
  text: string,
  bounds: EvidenceBounds,
): { preview: string; previewTruncated: boolean; maxBytesCut: boolean; totalBytes: number } {
  const totalBytes = Buffer.byteLength(text, "utf8")
  const start = bounds.start ?? 0
  // Every bound on this path is a byte count, so the window and the cap are
  // both applied in bytes on character boundaries: character slicing let one
  // CJK or emoji body overrun `maxBytes` fourfold — enough for the aggregate
  // budget to drop the whole entry — and disagree with `totalBytes` about
  // whether it was cut at all.
  const head = bounds.end === undefined ? text : truncateUtf8(text, bounds.end)
  const window = head.slice(truncateUtf8(head, start).length)
  const preview = truncateUtf8(window, bounds.maxBytes)
  const maxBytesCut = Buffer.byteLength(preview, "utf8") < Buffer.byteLength(window, "utf8")
  const windowed = start > 0 || (bounds.end !== undefined && bounds.end < totalBytes)
  return { preview, previewTruncated: windowed || maxBytesCut, maxBytesCut, totalBytes }
}

/** The fields of a text preview an evidence section carries: `maxBytesCut` is the inspection read's alone. */
function previewFields({ preview, previewTruncated, totalBytes }: ReturnType<typeof previewText>): {
  preview: string
  previewTruncated: boolean
  totalBytes: number
} {
  return { preview, previewTruncated, totalBytes }
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
 * Hold the page to the aggregate inline budget. Over-budget pages drop previews
 * largest-first — request/response bodies and a browser step's page text and
 * snapshot window — and mark those entries `budgetOmitted` with a stated
 * selector (refetch the node alone) — metadata and counts always survive.
 */
// fallow-ignore-next-line complexity
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
    bytes: droppablePreviewBytes(item),
  })).sort((left, right) => right.bytes - left.bytes)
  let omittedBodyCount = 0
  let budgetBytes = withoutBudget.budgetBytes
  for (const { index, bytes } of sizes) {
    if (budgetBytes <= page.budgetLimitBytes || bytes === 0) break
    const item = items[index]!
    const freed = droppablePreviewBytes(item)
    const dropped = dropPreviews(item)
    items[index] = { ...dropped.item, budgetOmitted: true }
    omittedBodyCount += dropped.omittedBodies
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

/**
 * JSON-encoded bytes of every preview one entry may lose: the request and
 * response bodies, and a browser step's page text (compared values, detail and
 * the snapshot window). Counted as they serialize — quotes and escapes
 * included — so `freed` is exactly the page size that disappears.
 */
function droppablePreviewBytes(item: NodeEvidence): number {
  return encodedBytes(item.request?.preview)
    + encodedBytes(item.response?.preview)
    + encodedBytes(item.browser?.expected)
    + encodedBytes(item.browser?.actual)
    + encodedBytes(item.browser?.detail)
    + encodedBytes(item.browser?.ariaSnapshot?.preview)
}

function encodedBytes(text: string | undefined): number {
  return text === undefined ? 0 : Buffer.byteLength(JSON.stringify(text), "utf8")
}

/**
 * Copy one entry with its droppable previews removed. Request/response keep
 * their truncation accounting (`previewTruncated`, `totalBytes`) and a browser
 * step keeps its ARIA totals plus `action`/`hasScreenshot`, so a dropped
 * preview reads as a size the caller can refetch — never as "nothing was
 * stored". Only request and response bodies count as `omittedBodies`; a browser
 * step's dropped text is signalled by the entry's `budgetOmitted`.
 */
function dropPreviews(item: NodeEvidence): { item: NodeEvidence; omittedBodies: number } {
  const dropped = { ...item }
  let omittedBodies = 0
  if (dropped.request !== undefined) {
    if (dropped.request.preview !== undefined) omittedBodies += 1
    dropped.request = dropRequestPreview(dropped.request)
  }
  if (dropped.response !== undefined) {
    if (dropped.response.preview !== undefined) omittedBodies += 1
    dropped.response = dropResponsePreview(dropped.response)
  }
  if (dropped.browser !== undefined) dropped.browser = dropBrowserText(dropped.browser)
  return { item: dropped, omittedBodies }
}

/** Copy a browser section without the page text that pushed the page over budget. */
function dropBrowserText(section: NonNullable<NodeEvidence["browser"]>): NonNullable<NodeEvidence["browser"]> {
  const snapshot = section.ariaSnapshot === undefined ? undefined : dropSnapshotPreview(section.ariaSnapshot)
  const rest = { ...section }
  delete rest.expected
  delete rest.actual
  delete rest.detail
  delete rest.ariaSnapshot
  return {
    ...rest,
    ...(snapshot === undefined ? {} : { ariaSnapshot: snapshot }),
  }
}

/** Copy a snapshot preview without its window, keeping the size that states what is missing. */
function dropSnapshotPreview(
  section: NonNullable<NonNullable<NodeEvidence["browser"]>["ariaSnapshot"]>,
): NonNullable<NonNullable<NodeEvidence["browser"]>["ariaSnapshot"]> {
  const rest = { ...section }
  delete rest.preview
  return rest
}
