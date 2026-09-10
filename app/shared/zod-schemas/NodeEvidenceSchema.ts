import { z } from "zod"
import { AssertionEvaluationSchema } from "./AssertionEvaluationSchema"
import { ExtractorOutcomeSchema } from "./ExtractorOutcomeSchema"
import { RunnerNodeStatusSchema } from "./RunnerNodeStatusSchema"
import { TimestampSchema } from "./TimestampSchema"

const EvidenceRequestSchema = z
  .object({
    method: z.string().nullable(),
    url: z.string().nullable(),
    preview: z.string().optional(),
    previewTruncated: z.boolean().optional(),
    totalBytes: z.number().int().nonnegative().optional(),
  })
  .strict()

const EvidenceResponseSchema = z
  .object({
    statusCode: z.number().int().nullable(),
    preview: z.string().optional(),
    previewTruncated: z.boolean().optional(),
    storedTruncated: z.boolean(),
    totalBytes: z.number().int().nonnegative().optional(),
    pathStatus: z.enum(["resolved", "path-missing", "type-mismatch"]).optional(),
  })
  .strict()

/**
 * Targeted evidence for one node of a run. Sections the caller did not ask
 * for are named in `omittedSections`, never silently absent. Four states are
 * reported distinctly:
 * - `missing` (the id is listed on the page, not here),
 * - `redacted` (the transport withheld a value; structure stays intact),
 * - `storedTruncated` (the runner captured only part of the body),
 * - `budgetOmitted` (the inline budget dropped this preview; refetch this
 *   node alone for its full preview).
 * `expectedStatus` and `unresolvedPlaceholders` are always present when
 * stored, so a matched negative test or a missing value is legible without a
 * second read.
 */
export const NodeEvidenceSchema = z
  .object({
    nodeId: z.string().min(1),
    status: RunnerNodeStatusSchema,
    durationMs: z.number().int().nonnegative(),
    startedAt: TimestampSchema.nullable().optional(),
    completedAt: TimestampSchema.nullable().optional(),
    expectedStatus: z.union([z.number(), z.array(z.number())]).optional(),
    secretRefs: z.array(z.string()),
    unresolvedPlaceholders: z.array(z.string()),
    hasError: z.boolean(),
    error: z.string().nullable().optional(),
    assertions: z.array(AssertionEvaluationSchema).nullable().optional(),
    extractorOutcomes: z.array(ExtractorOutcomeSchema).optional(),
    request: EvidenceRequestSchema.optional(),
    response: EvidenceResponseSchema.optional(),
    omittedSections: z.array(z.string().min(1)),
    budgetOmitted: z.boolean(),
  })
  .strict()
