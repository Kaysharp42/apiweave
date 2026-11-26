/**
 * Stated budgets for the focused-read surface (MCP optimization phase 2).
 * Every bounded read names its default, maximum and the aggregate inline
 * budget in its contract, so continuations are explicit and no JSON is ever
 * silently sliced.
 */

/** Default/maximum workflow rows per `workflows.search` page. */
export const WORKFLOW_SEARCH_DEFAULT_LIMIT = 20
export const WORKFLOW_SEARCH_MAX_LIMIT = 100

/** Default/maximum node summaries per `workflows.get` outline page. */
export const WORKFLOW_OUTLINE_DEFAULT_LIMIT = 100
export const WORKFLOW_OUTLINE_MAX_LIMIT = 500

/** Default/maximum matches per `workflows.searchNodes` result. */
export const NODE_SEARCH_DEFAULT_LIMIT = 20
export const NODE_SEARCH_MAX_LIMIT = 100

/** Default/maximum workflows per `workspaces.map` page. A 30-workflow workspace fits one default page. */
export const WORKSPACE_MAP_DEFAULT_LIMIT = 30
export const WORKSPACE_MAP_MAX_LIMIT = 100

/** Maximum nodes per `workflows.get` nodes view and evidence page. */
export const NODE_DETAIL_MAX_LIMIT = 50

/** Default/maximum run rows per `runs.history` page. */
export const RUN_HISTORY_DEFAULT_LIMIT = 20
export const RUN_HISTORY_MAX_LIMIT = 100

/** Default/maximum preview bytes per request/response body or browser text in node evidence. */
export const EVIDENCE_PREVIEW_DEFAULT_BYTES = 2048
export const EVIDENCE_PREVIEW_MAX_BYTES = 8192

/**
 * Per-iteration rows a Call Workflow node's `call` evidence section carries
 * inline. A for-each may run a thousand iterations; the rows that do not fit
 * are counted in `omittedIterationCount`, and a failed child's own run is
 * reachable through the called workflow's run history.
 */
export const CALL_EVIDENCE_MAX_ITERATIONS = 20

/**
 * Bytes of the `variables` section `runs.get` carries inline when the caller
 * opts in (`variables: true`) — the run's stored final variables, already
 * masked at capture. Entries that do not fit are dropped whole and named in
 * `omittedVariableNames`, never sliced mid-value: every returned value is the
 * stored value, and the accounting says what was left out.
 */
export const RUN_VARIABLES_BUDGET_BYTES = 8 * 1024

/** Default/maximum bounded wait for run observation (`runs.create` waitMs, `runs.wait`). */
export const RUN_WAIT_DEFAULT_MS = 10_000
export const RUN_WAIT_MAX_MS = 30_000

/**
 * Aggregate logical inline-JSON budget for one node-evidence page. Entries
 * that do not fit keep their metadata while their body previews are dropped
 * and marked `budgetOmitted` — never silently truncated.
 */
export const INLINE_RESULT_BUDGET_BYTES = 32 * 1024

/**
 * Stated budgets for the one-call debug-context surface (MCP optimization
 * phase 3). The whole response — identity, configs, diagnosis, evidence — is
 * held to the same 32 KiB aggregate inline budget as node evidence
 * (`INLINE_RESULT_BUDGET_BYTES`); over-budget sections are dropped
 * largest-first with explicit omission metadata and next-read selectors, while
 * counts still describe every failure.
 */

/** Maximum failed-node detail entries per `workflows.debugContext` response. */
export const DEBUG_CONTEXT_MAX_NODE_DETAILS = 5

/** Default/maximum run-correlated diagnosis items inline per debug context. */
export const DEBUG_CONTEXT_DEFAULT_ISSUE_LIMIT = 20
export const DEBUG_CONTEXT_MAX_ISSUE_LIMIT = 50

/** Default/maximum error characters per evidence entry in a debug context. */
export const DEBUG_CONTEXT_DEFAULT_ERROR_BYTES = 2048
export const DEBUG_CONTEXT_MAX_ERROR_BYTES = 8192

/**
 * Bytes of a browser step's scoped ARIA snapshot carried inline per evidence
 * entry. The debug read scopes first (dialog, else main, else page — the
 * part a locator lives in), then carries the opening of the scoped text only,
 * and states the scoped size; the whole window is a `runs_getNodeResult` call
 * away. The same cap applies to the step's `expected`/`actual` page text.
 */
export const DEBUG_CONTEXT_BROWSER_TEXT_BYTES = 2048

/**
 * Default/maximum bytes of the ARIA snapshot `browser.inspect` returns, counted
 * on the scoped text (`scope`, default "auto": dialog, else main, else page).
 * Larger than a node-evidence preview because the snapshot is the whole point
 * of the call, and the kept page is consumed by its one read — windowing past
 * the cut with `start`/`end` happens in the same call, or it means running the
 * workflow again; the maximum stays under the 32 KiB inline budget with room
 * for the rest.
 */
export const BROWSER_INSPECT_SNAPSHOT_DEFAULT_BYTES = 16 * 1024
export const BROWSER_INSPECT_SNAPSHOT_MAX_BYTES = 24 * 1024

/**
 * Cut `text` to at most `maxBytes` UTF-8 bytes on a character boundary, appending
 * a marker inside the value when anything was removed. For page text carried
 * as a plain string (a step's compared values), where there is no separate
 * truncation flag to state the cut: the marker is what stops a shortened string
 * being read as the page's actual text. The runner uses the same `…` for a
 * `detail` it had to cut.
 */
export function truncateUtf8Marked(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text
  const marker = "…"
  return `${truncateUtf8(text, Math.max(0, maxBytes - Buffer.byteLength(marker, "utf8")))}${marker}`
}

/**
 * Cut `text` to at most `maxBytes` UTF-8 bytes on a character boundary. Every
 * cap here is stated in bytes, so a preview has to be measured in them:
 * slicing by characters lets one multi-byte body overrun its cap several times
 * over (and blow the aggregate budget), while a cut mid-sequence would not be
 * valid UTF-8 at all.
 */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text
  let end = Math.max(0, Math.min(text.length, Math.floor((maxBytes / Math.max(1, Buffer.byteLength(text, "utf8"))) * text.length)))
  while (end > 0 && Buffer.byteLength(text.slice(0, end), "utf8") > maxBytes) {
    end = Math.floor(end * 0.9)
  }
  // A cut between the halves of a surrogate pair encodes as a replacement
  // character, not the astral character it belonged to: drop the lone half.
  if (end > 0 && end < text.length && (text.charCodeAt(end - 1) & 0xfc00) === 0xd800) end -= 1
  return text.slice(0, end)
}
