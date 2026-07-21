import { z } from "zod"
import { WorkspaceSchema } from "@shared/zod-schemas"
import type { IpcRouter } from "../router"
import type { HandlerDeps } from "./common"
import { NoInput } from "./common"

const workspaceId = z.object({ workspaceId: z.string().min(1) }).strict()

const createInput = z
  .object({
    name: z.string().min(1),
    slug: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    isPersonal: z.boolean().optional(),
  })
  .strict()

const updateInput = z
  .object({
    workspaceId: z.string().min(1),
    name: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    isPersonal: z.boolean().optional(),
  })
  .strict()

export function registerWorkspaceHandlers(router: IpcRouter, deps: HandlerDeps): void {
  const { workspaces } = deps

  router.register("workspaces", "list", {
    input: NoInput,
    output: z.array(WorkspaceSchema),
    handle: () => workspaces.list(),
  })

  router.register("workspaces", "create", {
    input: createInput,
    output: WorkspaceSchema,
    handle: (i) => workspaces.create(i),
  })

  router.register("workspaces", "get", {
    input: workspaceId,
    output: WorkspaceSchema,
    handle: (i) => workspaces.get(i.workspaceId),
  })

  router.register("workspaces", "update", {
    input: updateInput,
    output: WorkspaceSchema,
    handle: ({ workspaceId: id, ...patch }) => workspaces.update(id, patch),
  })

  router.register("workspaces", "delete", {
    input: workspaceId,
    output: z.null(),
    handle: async (i) => {
      await workspaces.delete(i.workspaceId)
      return null
    },
  })
}
