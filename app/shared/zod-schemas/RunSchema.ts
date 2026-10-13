import { z } from "zod"
import { JsonValueSchema } from "./JsonValueSchema"
import { RevisionSchema } from "./RevisionSchema"
import { ResolvedSecretInfoSchema } from "./ResolvedSecretInfoSchema"
import { RunIterationSchema } from "./RunIterationSchema"
import { RunResultSchema } from "./RunResultSchema"
import { TimestampSchema } from "./TimestampSchema"

export const RunSchema = z
  .object({
    runId: z.string().min(1),
    workspaceId: z.string().min(1),
    workflowId: z.string().min(1),
    selectedEnvironmentId: z.string().nullable().optional(),
    status: z.enum(["pending", "running", "completed", "failed", "cancelled", "interrupted"]),
    trigger: z.enum(["manual", "schedule"]),
    variables: z.record(z.string(), JsonValueSchema).default({}),
    results: z.array(RunResultSchema).default([]),
    startedAt: TimestampSchema.nullable().optional(),
    completedAt: TimestampSchema.nullable().optional(),
    duration: z.number().int().nonnegative().nullable().optional(),
    error: z.string().nullable().optional(),
    failedNodes: z.array(z.string()).nullable().optional(),
    failureMessage: z.string().nullable().optional(),
    nodeStatuses: z.record(z.string(), JsonValueSchema).default({}),
    resumeFromRunId: z.string().nullable().optional(),
    resumeFromNodeIds: z.array(z.string()).nullable().optional(),
    resumeMode: z.enum(["single", "all-failed"]).nullable().optional(),
    resolvedSecrets: z.array(ResolvedSecretInfoSchema).optional(),
    /** Set when the run is one iteration of a data-driven run. */
    iteration: RunIterationSchema.nullable().optional(),
    rev: RevisionSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
