import { z } from "zod"
import { AppliedAriaScopeSchema } from "./AriaScopeSchema"
import { JsonValueSchema } from "./JsonValueSchema"
import { McpWorkflowDiagnosisSchema } from "./McpWorkflowDiagnosisSchema"
import { EvidenceCallSchema } from "./NodeEvidenceSchema"
import { RevisionSchema } from "./RevisionSchema"
import { RunnerNodeStatusSchema } from "./RunnerNodeStatusSchema"
import { TimestampSchema } from "./TimestampSchema"
import { WorkflowEdgeSchema } from "./WorkflowEdgeSchema"
import { WorkflowNodeSchema } from "./WorkflowNodeSchema"

const DebugWorkflowSchema = z
  .object({
    workflowId: z.string().min(1),
    workspaceId: z.string().min(1),
    name: z.string().min(1),
    rev: RevisionSchema,
  })
  .strict()

const DebugRunSelectionSchema = z
  .object({
    policy: z.enum(["explicit", "latest-failed"]),
    runId: z.string().min(1).nullable(),
  })
  .strict()

const DebugRunSchema = z
  .object({
    runId: z.string().min(1),
    workflowId: z.string().min(1),
    status: z.enum(["pending", "running", "completed", "failed", "cancelled", "interrupted"]),
    workflowRev: RevisionSchema.nullable(),
    trigger: z.enum(["manual", "schedule"]),
    startedAt: TimestampSchema.nullable().optional(),
    completedAt: TimestampSchema.nullable().optional(),
    duration: z.number().int().nonnegative().nullable().optional(),
    selectedEnvironmentId: z.string().min(1).nullable().optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()

const DebugCorrelationSchema = z
  .object({
    status: z.enum(["current", "stale", "unknown"]),
    reason: z.string().min(1),
  })
  .strict()

const DebugFailureSummarySchema = z
  .object({
    failedNodeIds: z.array(z.string().min(1)),
    failedNodeCount: z.number().int().nonnegative(),
    blockedNodeIds: z.array(z.string().min(1)),
    blockedNodeCount: z.number().int().nonnegative(),
  })
  .strict()

const DebugBoundaryNodeSchema = z
  .object({
    nodeId: z.string().min(1),
    type: z.string().min(1),
    label: z.string().nullable(),
  })
  .strict()

const DebugEvidenceSelectorSchema = z
  .object({
    tool: z.literal("runs_getNodeResult"),
    args: z
      .object({
        workspaceId: z.string().min(1),
        runId: z.string().min(1),
        nodeIds: z.array(z.string().min(1)).min(1),
        sections: z.array(z.enum(["error", "assertions", "extractors", "request", "response", "browser", "call"])).min(1),
      })
      .strict(),
  })
  .strict()

/**
 * A failed browser step, compacted for the one-call debug read: what ran, what
 * it compared, which page it was on, and the start of its ARIA snapshot with
 * byte accounting — scoped to the open dialog or main landmark when the page
 * has one (`ariaSnapshotScope`; `ariaSnapshotScopeNote` says why a scope fell
 * back to the whole page). Screenshots are presence only. Budget pressure
 * removes the page text (see `dropBrowserSummaries`), never the identity
 * fields, so the `moreDetail` selector that asks for the `browser` section
 * stays meaningful.
 */
const DebugBrowserSummarySchema = z
  .object({
    action: z.string().min(1),
    url: z.string().optional(),
    title: z.string().optional(),
    expected: z.string().optional(),
    actual: z.string().optional(),
    hasScreenshot: z.boolean(),
    ariaSnapshotPreview: z.string().optional(),
    /** Present only when a snapshot was stored: the part of the page the preview windows. */
    ariaSnapshotScope: AppliedAriaScopeSchema.optional(),
    ariaSnapshotScopeNote: z.string().optional(),
    ariaSnapshotTruncated: z.boolean(),
    ariaSnapshotBytes: z.number().int().nonnegative(),
  })
  .strict()

const DebugEvidenceSchema = z
  .object({
    nodeId: z.string().min(1),
    status: RunnerNodeStatusSchema,
    hasError: z.boolean(),
    errorPreview: z.string().optional(),
    errorTruncated: z.boolean(),
    errorBytes: z.number().int().nonnegative(),
    expectedStatus: z.union([z.number(), z.array(z.number())]).optional(),
    responseStatusCode: z.number().int().nullable(),
    unresolvedPlaceholders: z.array(z.string().min(1)),
    assertionFailureCount: z.number().int().nonnegative(),
    extractorMissCount: z.number().int().nonnegative(),
    browser: DebugBrowserSummarySchema.optional(),
    /** A Call Workflow node's child runs — the same summary the evidence read carries. */
    call: EvidenceCallSchema.optional(),
    moreDetail: DebugEvidenceSelectorSchema,
  })
  .strict()

const DebugPlaceholdersSchema = z
  .object({
    unresolved: z.array(z.string().min(1)),
    unresolvedCount: z.number().int().nonnegative(),
  })
  .strict()

const DebugEnvironmentKeySchema = z
  .object({
    name: z.string().min(1),
    present: z.boolean(),
    sourceEnvironmentId: z.string().min(1).nullable(),
    sourceEnvironmentName: z.string().nullable(),
  })
  .strict()

const DebugEnvironmentSchema = z
  .object({
    workflowSelectedEnvironmentId: z.string().min(1).nullable(),
    runSelectedEnvironmentId: z.string().min(1).nullable(),
    evaluatedEnvironmentId: z.string().min(1).nullable(),
    evaluatedEnvironmentName: z.string().nullable(),
    keys: z.array(DebugEnvironmentKeySchema),
    totalKeyCount: z.number().int().nonnegative(),
  })
  .strict()

const DebugSecretSchema = z
  .object({
    name: z.string().min(1),
    resolved: z.boolean(),
    scopeType: z.enum(["environment", "workspace"]).nullable(),
    fromRun: z.boolean(),
  })
  .strict()

const DebugNextReadSchema = z
  .object({
    tool: z.string().min(1),
    args: z.record(z.string(), JsonValueSchema),
    reason: z.string().min(1),
  })
  .strict()

/**
 * One-call debug context for a known workflow: identity plus current revision,
 * the chosen run (explicit or latest failed, policy stated), failed/blocked
 * summary with run-correlated diagnosis, full configs of at most five relevant
 * failed nodes plus their nearest dependencies with incident edges, unresolved
 * placeholders, environment key presence with provenance, secret
 * names/resolution metadata only (never values), and bounded error evidence
 * with selectors for more detail — a failed browser step adds its action,
 * page URL/title, compared values and the start of its ARIA snapshot, and a
 * failed Call Workflow node adds its child-run summary (target, child runIds,
 * per-iteration statuses) so the callee's own run is one read away.
 *
 * Held to a 32 KiB aggregate inline budget. Over-budget detail moves to
 * `omittedNodeIds`/`nextReads` with explicit continuation arguments — counts
 * still describe every failure, and partial reads are never presented as
 * complete. `run.workflowRev` is the workflow revision the run executed
 * (null for runs recorded before it was tracked); `graphCorrelation` compares
 * that revision with the current one.
 */
export const WorkflowDebugContextSchema = z
  .object({
    workflow: DebugWorkflowSchema,
    runSelection: DebugRunSelectionSchema,
    run: DebugRunSchema.nullable(),
    graphCorrelation: DebugCorrelationSchema,
    failureSummary: DebugFailureSummarySchema,
    diagnosis: McpWorkflowDiagnosisSchema,
    nodes: z.array(WorkflowNodeSchema),
    edges: z.array(WorkflowEdgeSchema),
    boundaryNodes: z.array(DebugBoundaryNodeSchema),
    missingNodeIds: z.array(z.string().min(1)),
    omittedNodeIds: z.array(z.string().min(1)),
    totalRelevantNodeCount: z.number().int().nonnegative(),
    evidence: z.array(DebugEvidenceSchema),
    placeholders: DebugPlaceholdersSchema,
    environment: DebugEnvironmentSchema,
    secrets: z.array(DebugSecretSchema),
    totalSecretCount: z.number().int().nonnegative(),
    budgetBytes: z.number().int().nonnegative(),
    budgetLimitBytes: z.number().int().positive(),
    nextReads: z.array(DebugNextReadSchema),
  })
  .strict()
