import fs from "node:fs"
import { z } from "zod"
import { RunSchema, JsonValueSchema, RunHistoryPageSchema, NodeEvidencePageSchema } from "@shared/zod-schemas"
import type { IpcRouter } from "../router"
import type { HandlerDeps } from "./common"
import { listResult } from "./common"
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
import { readReportArtifacts, resolveArtifactPath } from "../../runner/reporters"

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
    waitMs: z.number().int().min(0).max(RUN_WAIT_MAX_MS).optional().describe("Bounded wait after enqueue in ms (default 10000, max 30000). 0 returns immediately with the queued snapshot; otherwise waits for completion up to this long and returns the current run on deadline — reuse its runId with runs_wait. A timeout or disconnect never cancels the run."),
    operationId: z.string().min(1).max(128).optional().describe("Caller idempotency key for safe retries: the same id in the same workspace with the same request returns the first run instead of enqueueing again; the same id with a changed request conflicts."),
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
        },
        context?.signal !== undefined ? { signal: context.signal } : {},
      ),
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

  // --- Artifact IPC handlers (Task 16) ---
  //
  // Security: every artifact handler requires workspaceId and authorizes the run
  // through RunService.get (scope + permission check, workspace ownership). The
  // runId is renderer-controlled, so all derived paths are resolved under the
  // runs root and checked for traversal before any filesystem or shell call.
  // No raw renderer path is ever passed to shell.openPath or fs.
  // See: unsafe-electron-shell + path-traversal findings.

  const artifactListInput = z.object({ workspaceId: ws, runId: z.string().min(1) }).strict()

  router.register("runs", "getArtifacts", {
    input: artifactListInput,
    output: z.unknown(),
    handle: async ({ workspaceId, runId }) => {
      await runs.get(workspaceId, runId)
      const { app } = await import("electron")
      const baseDir = app.getPath("temp")
      return readReportArtifacts(runId, baseDir)
    },
  })

  // Never accept a raw path from the renderer: derive the artifact path in the
  // main process from runId + a fixed artifact enum, resolved under the runs
  // root (resolveArtifactPath guards traversal). See path-traversal finding.
  const artifactAccessInput = z
    .object({
      workspaceId: ws,
      runId: z.string().min(1),
      artifactName: z.enum(["junit.xml", "report.html"]),
    })
    .strict()

  router.register("runs", "openArtifact", {
    input: artifactAccessInput,
    output: z.string(),
    handle: async ({ workspaceId, runId, artifactName }) => {
      await runs.get(workspaceId, runId)
      const { app, shell } = await import("electron")
      const baseDir = app.getPath("temp")
      const artifactPath = resolveArtifactPath(baseDir, runId, artifactName)
      return shell.openPath(artifactPath)
    },
  })

  router.register("runs", "saveArtifactAs", {
    input: artifactAccessInput,
    output: z.string().nullable(),
    handle: async ({ workspaceId, runId, artifactName }) => {
      await runs.get(workspaceId, runId)
      const { app, dialog } = await import("electron")
      const baseDir = app.getPath("temp")
      const srcPath = resolveArtifactPath(baseDir, runId, artifactName)

      const result = await dialog.showSaveDialog({
        defaultPath: artifactName,
        filters: [
          { name: artifactName.endsWith(".xml") ? "XML Files" : "HTML Files", extensions: [artifactName.split(".").pop() ?? ""] },
        ],
      })

      if (result.canceled || !result.filePath) {
        return null
      }

      await fs.promises.copyFile(srcPath, result.filePath)
      return result.filePath
    },
  })
}
