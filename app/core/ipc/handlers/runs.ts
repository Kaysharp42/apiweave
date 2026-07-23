import fs from "node:fs"
import { z } from "zod"
import { RunSchema, JsonValueSchema } from "@shared/zod-schemas"
import type { IpcRouter } from "../router"
import type { HandlerDeps } from "./common"
import { listResult } from "./common"
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

  const artifactInput = z.object({ runId: z.string().min(1) }).strict()

  router.register("runs", "getArtifacts", {
    input: artifactInput,
    output: z.unknown(),
    handle: async ({ runId }) => {
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
      runId: z.string().min(1),
      artifactName: z.enum(["junit.xml", "report.html"]),
    })
    .strict()

  router.register("runs", "openArtifact", {
    input: artifactAccessInput,
    output: z.string(),
    handle: async ({ runId, artifactName }) => {
      const { app, shell } = await import("electron")
      const baseDir = app.getPath("temp")
      const artifactPath = resolveArtifactPath(baseDir, runId, artifactName)
      return shell.openPath(artifactPath)
    },
  })

  router.register("runs", "saveArtifactAs", {
    input: artifactAccessInput,
    output: z.string().nullable(),
    handle: async ({ runId, artifactName }) => {
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
