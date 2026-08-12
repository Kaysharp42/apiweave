import fs from "node:fs"
import { z } from "zod"
import { RunSchema, JsonValueSchema } from "@shared/zod-schemas"
import type { IpcRouter } from "../router"
import type { HandlerDeps } from "./common"
import { listResult } from "./common"
import { NotFoundError } from "../errors"
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
  })
  .strict()

const runIdInput = z.object({ workspaceId: ws, runId: z.string().min(1) }).strict()
const workflowIdInput = z.object({ workspaceId: ws, workflowId: z.string().min(1) }).strict()

// Single-node request/response fetch. The metadata-only `runs.get` projection
// keeps the body and headers off the wire because most reads don't need them —
// but when a single node fails, the body is where the target explains the
// failure, and stripping it sends the user grepping Java source and Postgres
// for an answer the response already contained. Opt-in by node: only the
// one node an agent asks about travels, and the same redaction pass every
// other MCP read applies (Authorization headers, secret-looking values, URL
// query strings) still runs on the MCP transport.
const nodeResultInput = z
  .object({ workspaceId: ws, runId: z.string().min(1), nodeId: z.string().min(1) })
  .strict()

export function registerRunHandlers(router: IpcRouter, deps: HandlerDeps): void {
  const { runs } = deps

  router.register("runs", "create", {
    input: createInput,
    output: RunSchema,
    handle: ({ workspaceId, ...input }) => runs.createRun(workspaceId, input),
  })

  router.register("runs", "get", {
    input: runIdInput,
    output: RunSchema,
    handle: (i) => runs.get(i.workspaceId, i.runId),
  })

  router.register("runs", "getNodeResult", {
    input: nodeResultInput,
    output: z.unknown(),
    handle: async ({ workspaceId, runId, nodeId }) => {
      const run = await runs.get(workspaceId, runId)
      const result = run.results.find((r) => r.nodeId === nodeId)
      if (result === undefined) {
        throw new NotFoundError(`node ${nodeId} not found in run ${runId}`)
      }
      return {
        runId: run.runId,
        workflowId: run.workflowId,
        nodeId,
        status: result.status,
        duration: result.duration,
        startedAt: result.startedAt ?? null,
        completedAt: result.completedAt ?? null,
        request: result.request ?? null,
        response: result.response ?? null,
        error: result.error ?? null,
        extractorOutcomes: result.extractorOutcomes ?? [],
        unresolvedPlaceholders: result.unresolvedPlaceholders ?? [],
        assertions: result.assertions ?? [],
      }
    },
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
