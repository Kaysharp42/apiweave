import { z } from "zod"
import { AssertionEvaluationSchema } from "./AssertionEvaluationSchema"
import { AppliedAriaScopeSchema } from "./AriaScopeSchema"
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
    pathStatus: z.enum(["resolved", "path-missing", "type-mismatch", "invalid-path"]).optional(),
  })
  .strict()

/**
 * A page's ARIA (accessibility) snapshot is page content, routinely tens of
 * kilobytes long, so it travels as the same bounded, windowable preview a
 * response body does — after scoping to one part of the page: `scope` says
 * which part (the open dialog, the main landmark, or the whole page —
 * `"auto"` resolved to one of the three, and `scopeNote` says why a
 * requested scope fell back to the whole page). `preview` is a byte window
 * (`maxBytes`/`start`/`end`) into the SCOPED text, `previewTruncated` says
 * the window is not all of it, and `totalBytes` is the scoped text's size so
 * the caller can choose offsets.
 */
const EvidenceBrowserSnapshotSchema = z
  .object({
    preview: z.string().optional(),
    previewTruncated: z.boolean().optional(),
    totalBytes: z.number().int().nonnegative().optional(),
    scope: AppliedAriaScopeSchema,
    scopeNote: z.string().optional(),
  })
  .strict()

/**
 * A `browser` node's step evidence. `expected`/`actual` can be long page text
 * (an element's innerText), so they are cut to the caller's preview cap with a
 * trailing marker; the snapshot's window is accounted separately. The
 * screenshot is named as a presence flag only — its bytes and its artifact id
 * are never part of an agent read.
 */
const EvidenceBrowserSchema = z
  .object({
    action: z.string().min(1),
    url: z.string().optional(),
    title: z.string().optional(),
    expected: z.string().optional(),
    actual: z.string().optional(),
    detail: z.string().optional(),
    evidenceNote: z.string().optional(),
    hasScreenshot: z.boolean(),
    ariaSnapshot: EvidenceBrowserSnapshotSchema.optional(),
  })
  .strict()

/**
 * A Call Workflow node's child-run summary. `runId` (and each for-each
 * iteration's `runId`) is how an agent follows a failed call into the called
 * workflow's own run; iteration rows are capped with the remainder counted in
 * `omittedIterationCount`, never silently dropped. Shared with the debug
 * context's evidence entries so the two reads agree on a call.
 */
export const EvidenceCallSchema = z
  .object({
    workflowId: z.string().min(1),
    runId: z.string().min(1).optional(),
    status: z.enum(["passed", "failed", "cancelled"]),
    nodeCount: z.number().int().nonnegative(),
    failedNodeCount: z.number().int().nonnegative(),
    forEach: z
      .object({
        itemCount: z.number().int().nonnegative(),
        ranCount: z.number().int().nonnegative(),
        failedCount: z.number().int().nonnegative(),
        iterations: z.array(
          z.object({
            index: z.number().int().nonnegative(),
            runId: z.string().min(1).optional(),
            status: z.enum(["passed", "failed", "cancelled"]),
          }),
        ),
        omittedIterationCount: z.number().int().nonnegative(),
      })
      .optional(),
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
    browser: EvidenceBrowserSchema.optional(),
    call: EvidenceCallSchema.optional(),
    omittedSections: z.array(z.string().min(1)),
    budgetOmitted: z.boolean(),
  })
  .strict()
