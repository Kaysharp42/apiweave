import { z } from "zod"
import {
  WorkflowSchema,
  WorkflowNodeSchema,
  WorkflowEdgeSchema,
  JsonValueSchema,
  WorkflowDiagnosisSchema,
  RevisionSchema,
} from "@shared/zod-schemas"
import { canonicalizeNodeConfig } from "../../repositories/helpers"
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

export function registerWorkflowHandlers(router: IpcRouter, deps: HandlerDeps): void {
  const { workflows, workflowAnalysis } = deps

  router.register("workflows", "create", {
    input: createInput,
    output: WorkflowSchema,
    handle: ({ workspaceId, ...input }) => workflows.create(workspaceId, input),
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
    input: updateInput,
    output: WorkflowSchema,
    handle: ({ workspaceId, workflowId, ...patch }) =>
      workflows.update(workspaceId, workflowId, patch),
  })

  router.register("workflows", "patch", {
    input: patchInput,
    output: WorkflowSchema,
    handle: ({ workspaceId, workflowId, ...patch }) => workflows.patch(workspaceId, workflowId, patch),
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
