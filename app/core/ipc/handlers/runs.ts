import { z } from "zod"
import { RunSchema, JsonValueSchema, RunHistoryPageSchema, NodeEvidencePageSchema } from "@shared/zod-schemas"
import type { IpcRouter } from "../router"
import type { HandlerDeps } from "./common"
import { ifFound, listResult } from "./common"
import { ValidationError } from "../errors"
import {
  EVIDENCE_PREVIEW_MAX_BYTES,
  NODE_DETAIL_MAX_LIMIT,
  RUN_HISTORY_DEFAULT_LIMIT,
  RUN_HISTORY_MAX_LIMIT,
  RUN_WAIT_DEFAULT_MS,
  RUN_WAIT_MAX_MS,
} from "../../services/read_budgets"
import type { EvidenceSection } from "../../services/run_evidence"
import { buildReport } from "../../runner/reporters"
import { MAX_ITERATION_ROWS } from "@shared/iteration-data/iterationData"

const ws = z.string().min(1)

const createInput = z
  .object({
    workspaceId: ws,
    workflowId: z.string().min(1),
    status: z.enum(["pending", "running", "completed", "failed", "cancelled", "interrupted"]).optional(),
    trigger: z.enum(["manual", "schedule"]).optional(),
    variables: z.record(z.string(), JsonValueSchema).optional(),
    selectedEnvironmentId: z.string().nullable().optional(),
    nodeStatuses: z.record(z.string(), JsonValueSchema).optional(),
    data: z.record(z.string(), JsonValueSchema).optional().describe("One data row, read by the workflow as {{data.<column>}} (a data-driven run's iteration). For several rows, call runs_create once per row. Values are not stored with the run and are not masked: never put secrets here."),
    waitMs: z.number().int().min(0).max(RUN_WAIT_MAX_MS).optional().describe("Bounded wait after enqueue in ms (default 10000, max 30000). 0 returns immediately with the queued snapshot; otherwise waits for completion up to this long and returns the current run on deadline — reuse its runId with runs_wait. A timeout or disconnect never cancels the run."),
    operationId: z.string().min(1).max(128).optional().describe("Caller idempotency key for safe retries: the same id in the same workspace with the same request returns the first run instead of enqueueing again; the same id with a changed request conflicts."),
  })
  .strict()

const createIterationsInput = z
  .object({
    workspaceId: ws,
    workflowId: z.string().min(1),
    selectedEnvironmentId: z.string().nullable().optional(),
    rows: z.array(z.record(z.string(), JsonValueSchema)).min(1).max(MAX_ITERATION_ROWS),
  })
  .strict()

const runIdInput = z.object({ workspaceId: ws, runId: z.string().min(1) }).strict()

const waitInput = z.object({
  workspaceId: ws,
  runId: z.string().min(1),
  waitMs: z.number().int().min(0).max(RUN_WAIT_MAX_MS).optional().describe("How long to wait for completion in ms (default 10000, max 30000). 0 re-reads immediately. On deadline returns the current run — terminal:false in the MCP projection — plus its runId for another runs_wait. Cancelling the wait never cancels the run; use runs_cancel to stop it."),
}).strict()
const workflowIdInput = z.object({ workspaceId: ws, workflowId: z.string().min(1) }).strict()

const historyInput = z.object({
  workspaceId: ws,
  workflowId: z.string().min(1).optional().describe("Only runs of this workflow. Omitted lists the whole workspace."),
  status: z.enum(["pending", "running", "completed", "failed", "cancelled", "interrupted"]).optional().describe("Only runs in this status."),
  limit: z.number().int().min(1).max(RUN_HISTORY_MAX_LIMIT).optional().describe("Rows per page (default 20, max 100). Rows carry status/timing/failure counts, never per-node results."),
  cursor: z.string().min(1).optional().describe("Continue a history read. Bound to these filters and to the history revision; a stale cursor is rejected, so re-read without it."),
}).strict()

const evidenceSection = z.enum(["error", "assertions", "extractors", "request", "response"])

// Targeted evidence for a small node set. Bodies travel as bounded previews
// with explicit truncation accounting — never whole — and sections the caller
// skips are named in omittedSections. Unknown node ids are reported in
// missingNodeIds, not silently dropped.
const nodeResultInput = z.object({
  workspaceId: ws,
  runId: z.string().min(1),
  nodeId: z.string().min(1).optional().describe("One node to inspect. Prefer nodeIds for up to 50 nodes in one call."),
  nodeIds: z.array(z.string().min(1)).min(1).max(NODE_DETAIL_MAX_LIMIT).optional().describe("Nodes to inspect, in the order to return. Combined with nodeId at most 50."),
  sections: z.array(evidenceSection).min(1).optional().describe("Which evidence to include (default all). Omitted sections are named, never silently absent."),
  path: z.string().min(1).max(500).optional().describe("Extractor-grammar path (response.body.items[0].id) selecting within the RESPONSE body. A miss reports path-missing or type-mismatch distinctly."),
  maxBytes: z.number().int().min(1).max(EVIDENCE_PREVIEW_MAX_BYTES).optional().describe("Preview cap per body in bytes (default 2048)."),
  start: z.number().int().min(0).optional().describe("Start byte offset into a text preview; rounded down to a character boundary."),
  end: z.number().int().min(0).optional().describe("End byte offset into a text preview, rounded down to a character boundary; must exceed start."),
}).strict().superRefine((value, context) => {
  if (value.nodeId === undefined && value.nodeIds === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodeId"], message: "Name a node: nodeId for one, nodeIds for several." })
  }
  if (value.start !== undefined && value.end !== undefined && value.end <= value.start) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["end"], message: "end must be greater than start." })
  }
})

export function registerRunHandlers(router: IpcRouter, deps: HandlerDeps): void {
  const { runs } = deps

  router.register("runs", "create", {
    input: createInput,
    output: RunSchema,
    handle: ({ workspaceId, waitMs, operationId, ...input }, context) =>
      runs.createRun(
        workspaceId,
        input,
        {
          // Passed through: the service returns the queued snapshot when the
          // caller omits `waitMs` (the renderer observes runs over the per-run
          // progress topic). The agent-facing 10s default is applied by the MCP
          // transport in `mcp/bridge.ts`, not by this shared registry.
          ...(waitMs !== undefined ? { waitMs } : {}),
          ...(operationId !== undefined ? { operationId } : {}),
          ...(context?.agent !== undefined ? { agent: context.agent } : {}),
        },
        context?.signal !== undefined ? { signal: context.signal } : {},
      ),
  })

  // Renderer only (not on the MCP whitelist): a data-driven run, the workflow
  // once per row. Returns iteration 1's run; the rest are announced on the
  // run-started channel as they begin. An agent runs one row per runs_create.
  router.register("runs", "createIterations", {
    input: createIterationsInput,
    output: RunSchema,
    handle: ({ workspaceId, ...input }) => runs.createIterations(workspaceId, input),
  })

  router.register("runs", "wait", {
    input: waitInput,
    output: RunSchema,
    // `wait` keeps its default here, for every transport: an explicit wait with
    // no `waitMs` that returned immediately would be a no-op re-read. Only
    // `create` has a caller (the renderer) that must not block.
    handle: (i, context) =>
      runs.waitForRun(i.workspaceId, i.runId, i.waitMs ?? RUN_WAIT_DEFAULT_MS, context?.signal !== undefined ? { signal: context.signal } : {}),
  })

  router.register("runs", "get", {
    input: runIdInput,
    output: RunSchema,
    handle: (i) => runs.get(i.workspaceId, i.runId),
  })

  router.register("runs", "getNodeResult", {
    input: nodeResultInput,
    output: NodeEvidencePageSchema,
    handle: ({ workspaceId, runId, nodeId, nodeIds, sections, path, maxBytes, start, end }) => {
      const merged = [...(nodeId !== undefined ? [nodeId] : []), ...(nodeIds ?? [])]
      const ordered = [...new Set(merged)]
      if (ordered.length > NODE_DETAIL_MAX_LIMIT) {
        throw new ValidationError(`Select at most ${NODE_DETAIL_MAX_LIMIT} nodes per evidence read; got ${ordered.length}.`)
      }
      return runs.getNodeEvidence(workspaceId, runId, {
        nodeIds: ordered,
        ...(sections !== undefined ? { sections: sections as readonly EvidenceSection[] } : {}),
        ...(path !== undefined ? { path } : {}),
        ...(maxBytes !== undefined ? { maxBytes } : {}),
        ...(start !== undefined ? { start } : {}),
        ...(end !== undefined ? { end } : {}),
      })
    },
  })

  router.register("runs", "history", {
    input: historyInput,
    output: RunHistoryPageSchema,
    handle: (i) => runs.history(i.workspaceId, {
      ...(i.workflowId !== undefined ? { workflowId: i.workflowId } : {}),
      ...(i.status !== undefined ? { status: i.status } : {}),
    }, i.limit ?? RUN_HISTORY_DEFAULT_LIMIT, i.cursor),
  })

  router.register("runs", "listByWorkflow", {
    input: workflowIdInput,
    output: listResult(RunSchema),
    handle: (i) => runs.listByWorkflow(i.workspaceId, i.workflowId),
  })

  router.register("runs", "listByWorkspace", {
    input: z.object({ workspaceId: ws }).strict(),
    output: listResult(RunSchema),
    handle: (i) => runs.listByWorkspace(i.workspaceId),
  })

  router.register("runs", "getLatest", {
    input: workflowIdInput,
    output: RunSchema.nullable(),
    handle: async (i) => (await runs.getLatest(i.workspaceId, i.workflowId)) ?? null,
  })

  router.register("runs", "getLatestFailed", {
    input: workflowIdInput,
    output: RunSchema.nullable(),
    handle: async (i) => (await runs.getLatestFailed(i.workspaceId, i.workflowId)) ?? null,
  })

  router.register("runs", "cancel", {
    input: runIdInput,
    output: RunSchema,
    handle: (i) => runs.cancel(i.workspaceId, i.runId),
  })

  // Destructive history maintenance for the renderer's History panel. Not on
  // the MCP whitelist (core/mcp/tools.ts): an agent never deletes run history.
  router.register("runs", "delete", {
    input: runIdInput,
    output: z.null(),
    handle: async (i) => {
      await runs.deleteRun(i.workspaceId, i.runId)
      return null
    },
  })

  router.register("runs", "clearHistory", {
    input: workflowIdInput,
    output: z.object({ deleted: z.number().int().nonnegative() }).strict(),
    handle: (i) => runs.clearHistory(i.workspaceId, i.workflowId),
  })

  // Renderer only (not on the MCP whitelist): the whole report as one string,
  // which the renderer saves where the user picks. Built from the stored,
  // masked run — see core/runner/reporters.ts.
  router.register("runs", "report", {
    input: runIdInput.extend({ format: z.enum(["junit", "html"]) }).strict(),
    output: z.string(),
    handle: async ({ workspaceId, runId, format }) => {
      const run = await runs.get(workspaceId, runId)
      const workflow = await ifFound(deps.workflows.get(workspaceId, run.workflowId))
      return buildReport(format, { kind: "run", run, workflow })
    },
  })
}
