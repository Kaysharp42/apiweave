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

/** Default/maximum nodes per `workflows.get` nodes view and evidence page. */
export const NODE_DETAIL_DEFAULT_LIMIT = 10
export const NODE_DETAIL_MAX_LIMIT = 50

/** Default/maximum run rows per `runs.history` page. */
export const RUN_HISTORY_DEFAULT_LIMIT = 20
export const RUN_HISTORY_MAX_LIMIT = 100

/** Default/maximum preview bytes per request/response body in node evidence. */
export const EVIDENCE_PREVIEW_DEFAULT_BYTES = 2048
export const EVIDENCE_PREVIEW_MAX_BYTES = 8192

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
