import { z } from "zod"
import { JsonValueSchema } from "./JsonValueSchema"
import { RunnerNodeStatusSchema } from "./RunnerNodeStatusSchema"
import { TimestampSchema } from "./TimestampSchema"
import { AssertionEvaluationSchema } from "./AssertionEvaluationSchema"
import { ExtractorOutcomeSchema } from "./ExtractorOutcomeSchema"

export const RunResultSchema = z
  .object({
    nodeId: z.string().min(1),
    status: RunnerNodeStatusSchema,
    duration: z.number().int().nonnegative(),
    // Per-node execution window (ISO). Populated by the executor so the run
    // timeline/waterfall can place bars on an absolute run timeline. Absent on
    // runs recorded before this field existed — the view falls back to duration.
    startedAt: TimestampSchema.nullable().optional(),
    completedAt: TimestampSchema.nullable().optional(),
    // Names of {{secrets.NAME}} placeholders referenced by this node's config.
    // Safe metadata only (names); never values. Drives masked-secret confidence.
    secretRefs: z.array(z.string()).optional(),
    // Reference-shaped placeholders ({{env.*}}, {{variables.*}}, {{prev...}},
    // {{secrets.*}}) that went out as literal text because they could not be
    // resolved. Names only, per node — a request leaving with a literal
    // {{env.EMAIL}} commonly surfaces as a 401 that looks like bad credentials.
    unresolvedPlaceholders: z.array(z.string()).optional(),
    request: JsonValueSchema.nullable().optional(),
    response: JsonValueSchema.nullable().optional(),
    error: z.string().nullable().optional(),
    assertions: z.array(AssertionEvaluationSchema).nullable().optional(),
    extractorOutcomes: z.array(ExtractorOutcomeSchema).optional(),
    // Call Workflow summary only — never the sub-workflow's own raw per-node
    // results, which would bypass the top-level redaction pass in scheduler.ts.
    subWorkflow: z
      .object({
        workflowId: z.string().min(1),
        status: z.enum(["passed", "failed"]),
        nodeCount: z.number().int().nonnegative(),
        failedNodeCount: z.number().int().nonnegative(),
        outputVariableNames: z.array(z.string()),
      })
      .optional(),
  })
  .strict()
