import { z } from "zod"
import { JsonValueSchema } from "./JsonValueSchema"
import { McpWorkflowDiagnosisSchema } from "./McpWorkflowDiagnosisSchema"
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
    runRev: RevisionSchema,
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
    status: z.literal("unknown"),
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
        sections: z.array(z.enum(["error", "assertions", "extractors", "request", "response"])).min(1),
      })
      .strict(),
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
 * with selectors for more detail.
 *
 * Held to a 32 KiB aggregate inline budget. Over-budget detail moves to
 * `omittedNodeIds`/`nextReads` with explicit continuation arguments — counts
 * still describe every failure, and partial reads are never presented as
 * complete. `run.runRev` is the run record's own revision, never a workflow
 * revision; `graphCorrelation` stays unknown because run records do not carry
 * the executed workflow revision.
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
