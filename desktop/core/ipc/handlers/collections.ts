import { z } from "zod"
import { CollectionSchema, WorkflowSchema, WorkflowOrderItemSchema } from "../../../../shared/zod-schemas"
import type { IpcRouter } from "../router"
import type { HandlerDeps } from "./common"
import { listResult } from "./common"

const ws = z.string().min(1)

const createInput = z
  .object({
    workspaceId: ws,
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
    projectId: z.string().nullable().optional(),
    workflowOrder: z.array(WorkflowOrderItemSchema).optional(),
    continueOnFail: z.boolean().optional(),
  })
  .strict()

const updateInput = z
  .object({
    workspaceId: ws,
    collectionId: z.string().min(1),
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
    projectId: z.string().nullable().optional(),
    workflowCount: z.number().int().nonnegative().optional(),
    workflowOrder: z.array(WorkflowOrderItemSchema).optional(),
    continueOnFail: z.boolean().optional(),
  })
  .strict()

const idInput = z.object({ workspaceId: ws, collectionId: z.string().min(1) }).strict()
const membershipInput = z
  .object({ workspaceId: ws, collectionId: z.string().min(1), workflowId: z.string().min(1) })
  .strict()

export function registerCollectionHandlers(router: IpcRouter, deps: HandlerDeps): void {
  const { collections } = deps

  router.register("collections", "create", {
    input: createInput,
    output: CollectionSchema,
    handle: ({ workspaceId, ...input }) => collections.create(workspaceId, input),
  })

  router.register("collections", "get", {
    input: idInput,
    output: CollectionSchema,
    handle: (i) => collections.get(i.workspaceId, i.collectionId),
  })

  router.register("collections", "list", {
    input: z.object({ workspaceId: ws }).strict(),
    output: listResult(CollectionSchema),
    handle: (i) => collections.list(i.workspaceId),
  })

  router.register("collections", "update", {
    input: updateInput,
    output: CollectionSchema,
    handle: ({ workspaceId, collectionId, ...patch }) =>
      collections.update(workspaceId, collectionId, patch),
  })

  router.register("collections", "delete", {
    input: idInput,
    output: z.null(),
    handle: async (i) => {
      await collections.delete(i.workspaceId, i.collectionId)
      return null
    },
  })

  router.register("collections", "addWorkflow", {
    input: membershipInput,
    output: WorkflowSchema,
    handle: (i) => collections.addWorkflow(i.workspaceId, i.collectionId, i.workflowId),
  })

  router.register("collections", "removeWorkflow", {
    input: membershipInput,
    output: WorkflowSchema,
    handle: (i) => collections.removeWorkflow(i.workspaceId, i.collectionId, i.workflowId),
  })

  router.register("collections", "listWorkflows", {
    input: idInput,
    output: z.array(WorkflowSchema),
    handle: (i) => collections.listWorkflows(i.workspaceId, i.collectionId),
  })
}
