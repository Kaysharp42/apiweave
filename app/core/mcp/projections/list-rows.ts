import { z } from "zod"
import { RunHistoryPageSchema, WorkflowSearchPageSchema, WorkflowSummarySchema } from "@shared/zod-schemas"
import type { JsonValue } from "@shared/types/JsonValue"

/**
 * Agent-facing row shapes for the two list reads. The handlers keep returning
 * the full rows — the renderer's History panel and workflow list read them over
 * the same IPC path — so the trimming happens here, per projection, after the
 * router has validated and redacted the full result. Not done in
 * `encodeMcpResult`: a `null` there can be meaningful (`collectionId: null`
 * means unassigned).
 */

/** Search rows drop `workspaceId`: the caller supplied it, so it repeats on every row. */
const McpWorkflowSearchRowSchema = WorkflowSummarySchema.omit({ workspaceId: true })

export const McpWorkflowSearchPageSchema = WorkflowSearchPageSchema.extend({
  items: z.array(McpWorkflowSearchRowSchema),
})

/** History rows keep what a scan needs; `failedNodes` appears only when there are some. */
const McpRunHistoryRowSchema = z.object({
  runId: z.string().min(1),
  status: z.string(),
  startedAt: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  failedNodeCount: z.number().int().nonnegative(),
  failedNodes: z.array(z.string()).optional(),
})

export const McpRunHistoryPageSchema = RunHistoryPageSchema.extend({
  items: z.array(McpRunHistoryRowSchema),
})

export function projectWorkflowSearchPage(value: unknown): JsonValue {
  const page = WorkflowSearchPageSchema.parse(value)
  return {
    items: page.items.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "workspaceId"))),
    nextCursor: page.nextCursor,
  } as JsonValue
}

export function projectRunHistoryPage(value: unknown): JsonValue {
  const page = RunHistoryPageSchema.parse(value)
  return {
    items: page.items.map((run) => ({
      runId: run.runId,
      status: run.status,
      startedAt: run.startedAt ?? null,
      durationMs: run.duration ?? null,
      failedNodeCount: run.failedNodeCount,
      ...(run.failedNodes.length > 0 ? { failedNodes: run.failedNodes } : {}),
    })),
    nextCursor: page.nextCursor,
  } as JsonValue
}
