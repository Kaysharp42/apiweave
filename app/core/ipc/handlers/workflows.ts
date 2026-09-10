import { z } from "zod"
import {
  WorkflowSchema,
  WorkflowNodeSchema,
  WorkflowEdgeSchema,
  JsonValueSchema,
  WorkflowDiagnosisSchema,
  WorkflowDebugContextSchema,
  RevisionSchema,
  PositionSchema,
  WorkflowSearchPageSchema,
  WorkflowGetViewSchema,
  NodeSearchPageSchema,
} from "@shared/zod-schemas"
import type { WorkflowSummaryFilters } from "../../repositories/WorkflowRepository"
import {
  NODE_DETAIL_MAX_LIMIT,
  NODE_SEARCH_MAX_LIMIT,
  NODE_SEARCH_DEFAULT_LIMIT,
  WORKFLOW_OUTLINE_DEFAULT_LIMIT,
  WORKFLOW_OUTLINE_MAX_LIMIT,
  WORKFLOW_SEARCH_DEFAULT_LIMIT,
  WORKFLOW_SEARCH_MAX_LIMIT,
  DEBUG_CONTEXT_MAX_ERROR_BYTES,
  DEBUG_CONTEXT_MAX_ISSUE_LIMIT,
} from "../../services/read_budgets"
import { ValidationError } from "../errors"
import { canonicalizeNodeConfig } from "../../repositories/helpers"
import { DebugContextService } from "../../services/debug_context"
import { layoutWorkflowNodes } from "@shared/layout/workflowLayout"
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

const partialNodePatch = z
  .object({
    nodeId: z.string().min(1),
    type: z.enum(["http-request", "sse", "assertion", "delay", "merge", "start", "end", "workflow", "group", "note"]).optional(),
    label: z.string().nullable().optional(),
    position: PositionSchema.partial().optional(),
    parentId: z.string().min(1).nullable().optional().describe("Group frame this node sits inside; null takes it out of its frame. Changing it is a topology change for auto-layout."),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

const patchNodes = z.preprocess(
  (value) => (Array.isArray(value) ? value.map((node) => canonicalizeNodeConfig(node)) : value),
  z.array(z.union([WorkflowNodeSchema, partialNodePatch])),
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
    upsertNodes: patchNodes
      .optional()
      .describe("Nodes to add or patch, matched by nodeId. Existing nodes merge recursively: omitted config fields and position stay as stored. A new node must include its type and complete schema-valid config."),
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
    repositionNodes: z
      .record(z.string().min(1), PositionSchema)
      .optional()
      .describe(
        "Move existing nodes without resending them: a nodeId-to-position map applied after upserts/removals, to whichever named ids still exist. Position-only — unlike upsertNodes, a node moved only here is NOT counted in touchedNodeIds.",
      ),
  })
  .strict()

const idInput = z.object({ workspaceId: ws, workflowId: z.string().min(1) }).strict()
const getInput = idInput.extend({
  nodeIds: z.array(z.string().min(1)).min(1).max(NODE_DETAIL_MAX_LIMIT).optional().describe("Nodes view: return full configs for these nodes plus incident edges and boundary-node identities. Implies view nodes."),
  view: z.enum(["full", "outline", "nodes"]).optional().describe("full (default) returns the whole stored graph. outline returns bounded node ids/types/labels plus edge structure without positions or configs. nodes returns full configs for nodeIds plus incident edges. Partial views are marked partial:true and are never complete graphs."),
  nodeLimit: z.number().int().min(1).max(WORKFLOW_OUTLINE_MAX_LIMIT).optional().describe("Outline view: how many node summaries per page (default 100). Further pages arrive via nextNodeCursor."),
  nodeCursor: z.string().min(1).optional().describe("Outline view: continue a paged outline. Bound to the workflow revision; a stale cursor is rejected."),
}).strict().superRefine((value, context) => {
  if (value.view === "full" && value.nodeIds !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodeIds"], message: "nodeIds selects the nodes view; full returns the whole graph. Use view \"nodes\" for selected configs." })
  }
  if (value.view === "nodes" && value.nodeIds === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodeIds"], message: "The nodes view requires nodeIds: name up to 50 nodes to read." })
  }
})
const diagnoseInput = idInput.extend({ runId: z.string().min(1).optional() }).strict()

const debugContextInput = z.object({
  workspaceId: ws,
  workflowId: z.string().min(1),
  runId: z.string().min(1).optional().describe("Inspect this run. Omitted selects the latest failed run; the chosen policy is stated in runSelection."),
  nodeIds: z.array(z.string().min(1)).min(1).max(NODE_DETAIL_MAX_LIMIT).optional().describe("Extra nodes to detail beyond the failures, in priority order after them. Unknown ids are reported in missingNodeIds."),
  issueLimit: z.number().int().min(1).max(DEBUG_CONTEXT_MAX_ISSUE_LIMIT).optional().describe("Run-correlated diagnosis items inline (default 20, max 50). Totals always describe every issue; the rest arrive via nextReads."),
  errorBytes: z.number().int().min(1).max(DEBUG_CONTEXT_MAX_ERROR_BYTES).optional().describe("Error characters kept per evidence entry (default 2048, max 8192). Cut errors are marked errorTruncated with a runs_getNodeResult selector for more."),
}).strict()

const searchInput = z.object({
  workspaceId: ws,
  query: z.string().min(1).max(200).optional().describe("Case-insensitive substring match against the workflow NAME only. Never matches config values, so it cannot match a withheld secret."),
  collectionId: z.string().min(1).optional().describe("Narrow to one project. Omitted searches every workflow, including project-attached ones."),
  tags: z.array(z.string().min(1)).max(10).optional().describe("Every named tag must be present."),
  limit: z.number().int().min(1).max(WORKFLOW_SEARCH_MAX_LIMIT).optional().describe("Rows per page (default 20, max 100). Summaries carry counts, never graphs."),
  cursor: z.string().min(1).optional().describe("Continue a search. Bound to these filters and to the list revision; a stale cursor is rejected, so re-read without it."),
}).strict()

const searchNodesInput = z.object({
  workspaceId: ws,
  workflowId: z.string().min(1),
  query: z.string().min(1).max(200).optional().describe("Literal substring (never a regex) matched against nodeId, label, type, request method, URL path and extractor names. Bodies, headers, auth and values are never inspected."),
  nodeTypes: z.array(z.enum(["http-request", "sse", "assertion", "delay", "merge", "start", "end", "workflow", "group", "note"])).max(10).optional().describe("Only consider these node types."),
  limit: z.number().int().min(1).max(NODE_SEARCH_MAX_LIMIT).optional().describe("Matches per result (default 20, max 100). totalMatched always describes every match."),
}).strict().superRefine((value, context) => {
  if ((value.query === undefined || value.query.trim().length === 0) && value.nodeTypes === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["query"], message: "Give a query, nodeTypes, or both: an unfiltered search is just the outline." })
  }
})

const layoutDirection = z.enum(["LR", "TB"]).optional().describe('"LR" (default) for left-to-right request chains, "TB" for top-to-bottom.')

// MCP-only meta field (stripped before it reaches the repository): the service
// reads it to decide whether to re-lay-out the merged graph it is about to
// persist. Auto-layout runs only on topology changes (new/removed nodes,
// edges, edge handles, group membership); config/label-only writes keep every
// position.
const layoutFlag = z
  .boolean()
  .optional()
  .describe("Lay out the graph when this write changes topology (default true). Set false to keep the positions you sent as-is.")

export function registerWorkflowHandlers(router: IpcRouter, deps: HandlerDeps): void {
  const { workflows, workflowAnalysis, runs, environments } = deps
  const debugContext = new DebugContextService(workflows, runs, environments)

  router.register("workflows", "create", {
    input: createInput.extend({ layout: layoutFlag }).strict(),
    output: WorkflowSchema,
    handle: ({ workspaceId, layout, ...input }) => workflows.create(
      workspaceId,
      input,
      layout === true ? { layout: true } : layout === false ? { layout: false } : {},
    ),
  })

  router.register("workflows", "get", {
    input: getInput,
    output: WorkflowGetViewSchema,
    handle: (i) => {
      const view = i.view ?? (i.nodeIds !== undefined ? "nodes" : "full")
      if (view === "outline") {
        return workflows.getOutline(i.workspaceId, i.workflowId, i.nodeLimit ?? WORKFLOW_OUTLINE_DEFAULT_LIMIT, i.nodeCursor)
      }
      if (view === "nodes") {
        // The refine above guarantees nodeIds for an explicit nodes view; the
        // implied view carries the caller's own nodeIds.
        const nodeIds = i.nodeIds ?? []
        if (nodeIds.length === 0) {
          throw new ValidationError("The nodes view requires nodeIds: name up to 50 nodes to read.")
        }
        return workflows.getNodesView(i.workspaceId, i.workflowId, nodeIds)
      }
      return workflows.get(i.workspaceId, i.workflowId)
    },
  })

  router.register("workflows", "diagnose", {
    input: diagnoseInput,
    output: WorkflowDiagnosisSchema,
    handle: (i) => workflowAnalysis.diagnose(i.workspaceId, i.workflowId, i.runId),
  })

  router.register("workflows", "debugContext", {
    input: debugContextInput,
    output: WorkflowDebugContextSchema,
    handle: (i) => debugContext.debugContext({
      workspaceId: i.workspaceId,
      workflowId: i.workflowId,
      ...(i.runId !== undefined ? { runId: i.runId } : {}),
      ...(i.nodeIds !== undefined ? { nodeIds: i.nodeIds } : {}),
      ...(i.issueLimit !== undefined ? { issueLimit: i.issueLimit } : {}),
      ...(i.errorBytes !== undefined ? { errorBytes: i.errorBytes } : {}),
    }),
  })

  router.register("workflows", "list", {
    input: z.object({ workspaceId: ws, includeAttached: z.boolean().optional() }).strict(),
    output: listResult(WorkflowSchema),
    handle: (i) => workflows.list(i.workspaceId, i.includeAttached),
  })

  router.register("workflows", "search", {
    input: searchInput,
    output: WorkflowSearchPageSchema,
    handle: (i) => {
      const trimmed = i.query?.trim()
      const filters: WorkflowSummaryFilters = {
        ...(trimmed !== undefined && trimmed.length > 0 ? { query: trimmed } : {}),
        ...(i.collectionId !== undefined ? { collectionId: i.collectionId } : {}),
        ...(i.tags !== undefined && i.tags.length > 0 ? { tags: i.tags } : {}),
      }
      return workflows.search(i.workspaceId, filters, i.limit ?? WORKFLOW_SEARCH_DEFAULT_LIMIT, i.cursor)
    },
  })

  router.register("workflows", "searchNodes", {
    input: searchNodesInput,
    output: NodeSearchPageSchema,
    handle: (i) => workflows.searchNodes(i.workspaceId, i.workflowId, {
      query: i.query?.trim() ?? "",
      ...(i.nodeTypes !== undefined ? { nodeTypes: i.nodeTypes } : {}),
      limit: i.limit ?? NODE_SEARCH_DEFAULT_LIMIT,
    }),
  })

  router.register("workflows", "update", {
    input: updateInput.extend({ layout: layoutFlag }).strict(),
    output: WorkflowSchema,
    handle: ({ workspaceId, workflowId, layout, ...patch }) => workflows.update(
      workspaceId,
      workflowId,
      patch,
      layout === true ? { layout: true } : layout === false ? { layout: false } : {},
    ),
  })

  router.register("workflows", "patch", {
    input: patchInput.extend({ layout: layoutFlag }).strict(),
    output: WorkflowSchema,
    handle: ({ workspaceId, workflowId, layout, ...patch }) => workflows.patch(
      workspaceId,
      workflowId,
      layout === true ? { ...patch, layout: true } : layout === false ? { ...patch, layout: false } : patch,
    ),
  })

  router.register("workflows", "layout", {
    input: idInput.extend({ direction: layoutDirection }).strict(),
    output: WorkflowSchema,
    handle: async ({ workspaceId, workflowId, direction }) => {
      const existing = await workflows.get(workspaceId, workflowId)
      const nodes = layoutWorkflowNodes(existing.nodes, existing.edges, direction ?? "LR")
      return workflows.update(workspaceId, workflowId, { nodes })
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

  router.register("workflows", "moveToWorkspace", {
    input: z
      .object({
        workspaceId: ws,
        workflowId: z.string().min(1),
        targetWorkspaceId: ws.describe("Workspace to move the workflow into. Must differ from the current one."),
        targetCollectionId: z
          .string()
          .min(1)
          .nullable()
          .describe(
            "Project in the TARGET workspace to attach the workflow to, or null to leave it unassigned. A project in any other workspace is rejected.",
          ),
      })
      .strict(),
    output: WorkflowSchema,
    handle: (i) => workflows.moveToWorkspace(i.workspaceId, i.workflowId, i.targetWorkspaceId, i.targetCollectionId),
  })

  router.register("workflows", "setEnvironment", {
    input: z
      .object({ workspaceId: ws, workflowId: z.string().min(1), environmentId: z.string().min(1).nullable() })
      .strict(),
    output: WorkflowSchema,
    handle: (i) => workflows.setEnvironment(i.workspaceId, i.workflowId, i.environmentId),
  })
}
