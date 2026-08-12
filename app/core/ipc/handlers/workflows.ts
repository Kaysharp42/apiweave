import { z } from "zod"
import {
  WorkflowSchema,
  WorkflowNodeSchema,
  WorkflowEdgeSchema,
  JsonValueSchema,
  WorkflowDiagnosisSchema,
  RevisionSchema,
  WorkflowWriteResultSchema,
} from "@shared/zod-schemas"
import { canonicalizeNodeConfig } from "../../repositories/helpers"
import type { Workflow } from "@shared/types/Workflow"
import type { WorkflowDiagnosis } from "@shared/types/WorkflowDiagnosis"
import type { WorkflowNode } from "@shared/types/WorkflowNode"
import type { WorkflowEdge } from "@shared/types/WorkflowEdge"
import type { WorkflowWriteResult } from "@shared/types/WorkflowWriteResult"
import type { WorkflowAnalysisService } from "../../services/workflow_analysis_service"
import type { IpcRouter } from "../router"
import type { HandlerDeps } from "./common"
import { listResult } from "./common"

const ws = z.string().min(1)

// The repo canonicalises legacy KV shapes (string/Record) to KeyValuePair[],
// but only AFTER router.dispatch validates against the strict schema — so a
// workflow with legacy headers fails validation before that runs. Lift here,
// on the raw request, so create/update accept the same forms the repo does.
const canonicalNodes = z.preprocess(
  (value) => (Array.isArray(value) ? value.map((node) => canonicalizeNodeConfig(node)) : value),
  z.array(WorkflowNodeSchema),
)

/** Fields a client may set on create/update — server-managed columns (id/rev/timestamps) excluded. */
const mutableFields = {
  name: z.string().min(1).describe("Display name of the workflow."),
  description: z.string().nullable().optional(),
  nodes: canonicalNodes
    .optional()
    .describe("The complete node list. This REPLACES the stored nodes — send every node, not just changed ones. Use workflows.patch to change a subset."),
  edges: z
    .array(WorkflowEdgeSchema)
    .optional()
    .describe("The complete edge list, replacing the stored edges. Edges define execution order; a node with no inbound edge from start never runs."),
  variables: z
    .record(z.string(), JsonValueSchema)
    .optional()
    .describe('Workflow variables as a name-to-value map, read anywhere as "{{variables.NAME}}". Seed a variable here when it has a starting value; a variable produced by an HTTP node\'s extractor does not need an entry. Replaces the stored map.'),
  tags: z.array(z.string()).optional(),
  collectionId: z.string().nullable().optional().describe("Project this workflow belongs to, or null for none."),
  selectedEnvironmentId: z
    .string()
    .nullable()
    .optional()
    .describe('Environment supplying "{{env.NAME}}" values for runs of this workflow, or null for none.'),
  nodeTemplates: z.array(JsonValueSchema).optional(),
}

const createInput = z.object({ workspaceId: ws, ...mutableFields }).strict()
const updateInput = z
  .object({ workspaceId: ws, workflowId: z.string().min(1), ...mutableFields })
  .partial({ name: true })
  .strict()

/**
 * A subset change, so fixing two fields does not mean re-sending the whole
 * graph. Every list is optional; sending none is a no-op that still reports the
 * current workflow.
 */
const patchInput = z
  .object({
    workspaceId: ws,
    workflowId: z.string().min(1),
    expectedRevision: RevisionSchema.optional().describe(
      "The `rev` this patch was computed against. When set, the write is rejected with a conflict if the workflow changed meanwhile. Omit to apply unconditionally.",
    ),
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    upsertNodes: canonicalNodes
      .optional()
      .describe("Nodes to add or replace, matched by nodeId. A node not named here is left exactly as stored."),
    removeNodeIds: z
      .array(z.string().min(1))
      .optional()
      .describe("nodeIds to delete. Edges attached to a deleted node are dropped with it."),
    upsertEdges: z
      .array(WorkflowEdgeSchema)
      .optional()
      .describe("Edges to add or replace, matched by edgeId. Use this to fix a sourceHandle without resending the graph."),
    removeEdgeIds: z.array(z.string().min(1)).optional().describe("edgeIds to delete."),
    setVariables: z
      .record(z.string(), JsonValueSchema)
      .optional()
      .describe("Workflow variables to add or overwrite. Merges into the stored map; unnamed variables are untouched."),
    unsetVariables: z.array(z.string().min(1)).optional().describe("Workflow variable names to delete."),
  })
  .strict()

const idInput = z.object({ workspaceId: ws, workflowId: z.string().min(1) }).strict()
const diagnoseInput = idInput.extend({ runId: z.string().min(1).optional() }).strict()

// Echo shape toggle for graph-writing tools. The full graph echo blows MCP
// token budgets on large workflows (a single-rule patch returned all 130 nodes
// and 194 edges). Defaulting `workflows_patch` to "summary" returns just the
// `workflowId`, `rev`, counts, the ids the write touched, and the diagnosis —
// everything the documented "patch then read the diagnosis" loop needs.
const returnShape = z
  .enum(["diagnosis", "summary", "full"])
  .optional()
  .describe(
    "Shape of the response. \"summary\" (the default for workflows_patch) returns workflowId, rev, node/edge counts, the ids the write touched, and the diagnosis. \"diagnosis\" returns workflowId, rev and the diagnosis only. \"full\" echoes the whole persisted workflow (the default for workflows_create / workflows_update, and what the in-app renderer reads).",
  )

export function registerWorkflowHandlers(router: IpcRouter, deps: HandlerDeps): void {
  const { workflows, workflowAnalysis } = deps

  router.register("workflows", "create", {
    input: createInput.extend({ return: returnShape }).strict(),
    output: WorkflowWriteResultSchema,
    handle: ({ workspaceId, return: shape, ...input }) =>
      projectWriteResult(
        shape ?? "full",
        () => workflows.create(workspaceId, input),
        // The whole graph was written on create, so no "touched" set is meaningful.
        () => ({ touchedNodeIds: [] as string[], touchedEdgeIds: [] as string[] }),
        workflowAnalysis,
        workspaceId,
      ),
  })

  router.register("workflows", "get", {
    input: idInput,
    output: WorkflowSchema,
    handle: (i) => workflows.get(i.workspaceId, i.workflowId),
  })

  router.register("workflows", "diagnose", {
    input: diagnoseInput,
    output: WorkflowDiagnosisSchema,
    handle: (i) => workflowAnalysis.diagnose(i.workspaceId, i.workflowId, i.runId),
  })

  router.register("workflows", "list", {
    input: z.object({ workspaceId: ws, includeAttached: z.boolean().optional() }).strict(),
    output: listResult(WorkflowSchema),
    handle: (i) => workflows.list(i.workspaceId, i.includeAttached),
  })

  router.register("workflows", "update", {
    input: updateInput.extend({ return: returnShape }).strict(),
    output: WorkflowWriteResultSchema,
    handle: ({ workspaceId, workflowId, return: shape, ...patch }) =>
      projectWriteResult(
        shape ?? "full",
        () => workflows.update(workspaceId, workflowId, patch),
        // A whole-graph replace: no "touched" set is meaningful.
        () => ({ touchedNodeIds: [] as string[], touchedEdgeIds: [] as string[] }),
        workflowAnalysis,
        workspaceId,
      ),
  })

  router.register("workflows", "patch", {
    input: patchInput.extend({ return: returnShape }).strict(),
    output: WorkflowWriteResultSchema,
    handle: ({ workspaceId, workflowId, return: shape, ...patch }) => {
      const upsertNodeIds = ((patch.upsertNodes as readonly WorkflowNode[] | undefined) ?? []).map((n) => n.nodeId)
      const upsertEdgeIds = ((patch.upsertEdges as readonly WorkflowEdge[] | undefined) ?? []).map((e) => e.edgeId)
      return projectWriteResult(
        shape ?? "summary",
        () => workflows.patch(workspaceId, workflowId, patch),
        () => ({
          touchedNodeIds: [...upsertNodeIds, ...(patch.removeNodeIds ?? [])],
          touchedEdgeIds: [...upsertEdgeIds, ...(patch.removeEdgeIds ?? [])],
        }),
        workflowAnalysis,
        workspaceId,
      )
    },
  })

  router.register("workflows", "delete", {
    input: idInput,
    output: z.null(),
    handle: async (i) => {
      await workflows.delete(i.workspaceId, i.workflowId)
      return null
    },
  })

  router.register("workflows", "attachToCollection", {
    input: z
      .object({ workspaceId: ws, workflowId: z.string().min(1), collectionId: z.string().min(1).nullable() })
      .strict(),
    output: WorkflowSchema,
    handle: (i) => workflows.attachToCollection(i.workspaceId, i.workflowId, i.collectionId),
  })

  router.register("workflows", "setEnvironment", {
    input: z
      .object({ workspaceId: ws, workflowId: z.string().min(1), environmentId: z.string().min(1).nullable() })
      .strict(),
    output: WorkflowSchema,
    handle: (i) => workflows.setEnvironment(i.workspaceId, i.workflowId, i.environmentId),
  })
}

type WriteShape = "diagnosis" | "summary" | "full"

/**
 * Project a graph-write's result to the requested echo shape. "full" returns the
 * persisted {@link Workflow} unchanged — what the in-app renderer reads. "summary"
 * returns `workflowId`, `rev`, counts, the ids the write actually touched, and
 * the full diagnosis — the documented "patch then read the diagnosis" loop needs
 * only that. "diagnosis" returns `workflowId`, `rev` and the diagnosis.
 *
 * Returning the full graph echo from `workflows_patch` blew MCP token budgets on
 * a 130-node graph when the patch changed a single rule. Defaulting patch to
 * "summary" cuts the response to the part the author must act on.
 */
async function projectWriteResult(
  shape: WriteShape,
  write: () => Promise<Workflow>,
  touched: () => { touchedNodeIds: readonly string[]; touchedEdgeIds: readonly string[] },
  analysis: WorkflowAnalysisService,
  workspaceId: string,
): Promise<WorkflowWriteResult> {
  const workflow = await write()
  if (shape === "full") return workflow
  const diagnosis = await safeDiagnose(analysis, workspaceId, workflow.workflowId)
  if (shape === "diagnosis") {
    return {
      kind: "diagnosis" as const,
      workflowId: workflow.workflowId,
      rev: workflow.rev,
      diagnosis,
    }
  }
  const { touchedNodeIds, touchedEdgeIds } = touched()
  return {
    kind: "summary" as const,
    workflowId: workflow.workflowId,
    rev: workflow.rev,
    nodeCount: workflow.nodes.length,
    edgeCount: workflow.edges.length,
    touchedNodeIds: [...touchedNodeIds].sort() as string[],
    touchedEdgeIds: [...touchedEdgeIds].sort() as string[],
    diagnosis,
  }
}

/** Best-effort: the write already committed, so a failed diagnosis becomes an empty one. */
async function safeDiagnose(
  analysis: WorkflowAnalysisService,
  workspaceId: string,
  workflowId: string,
): Promise<WorkflowDiagnosis> {
  try {
    return await analysis.diagnose(workspaceId, workflowId)
  } catch {
    return {
      workflowId,
      summary: { errors: 0, warnings: 0, notices: 0 },
      diagnostics: [],
    }
  }
}
