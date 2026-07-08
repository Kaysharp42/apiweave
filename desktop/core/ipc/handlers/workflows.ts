import { z } from "zod"
import {
  WorkflowSchema,
  WorkflowNodeSchema,
  WorkflowEdgeSchema,
  JsonValueSchema,
} from "../../../../shared/zod-schemas"
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
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  nodes: canonicalNodes.optional(),
  edges: z.array(WorkflowEdgeSchema).optional(),
  variables: z.record(z.string(), JsonValueSchema).optional(),
  tags: z.array(z.string()).optional(),
  collectionId: z.string().nullable().optional(),
  selectedEnvironmentId: z.string().nullable().optional(),
  nodeTemplates: z.array(JsonValueSchema).optional(),
}

const createInput = z.object({ workspaceId: ws, ...mutableFields }).strict()
const updateInput = z
  .object({ workspaceId: ws, workflowId: z.string().min(1), ...mutableFields })
  .partial({ name: true })
  .strict()

const idInput = z.object({ workspaceId: ws, workflowId: z.string().min(1) }).strict()

export function registerWorkflowHandlers(router: IpcRouter, deps: HandlerDeps): void {
  const { workflows } = deps

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
