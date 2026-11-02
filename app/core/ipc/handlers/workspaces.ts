import { z } from "zod"
import { WorkspaceMapPageSchema, WorkspaceSchema } from "@shared/zod-schemas"
import { WORKSPACE_MAP_DEFAULT_LIMIT, WORKSPACE_MAP_MAX_LIMIT } from "../../services/read_budgets"
import { WorkspaceMapService } from "../../services/workspace_map"
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

const mapInput = z
  .object({
    workspaceId: z.string().min(1),
    collectionId: z.string().min(1).optional().describe("Narrow to one project."),
    limit: z.number().int().min(1).max(WORKSPACE_MAP_MAX_LIMIT).optional().describe("Workflows per page (default 30, max 100)."),
    cursor: z.string().min(1).optional().describe("Continue the map; rejected once the workflows change."),
  })
  .strict()

export function registerWorkspaceHandlers(router: IpcRouter, deps: HandlerDeps): void {
  const { workspaces } = deps
  const workspaceMap = new WorkspaceMapService(deps.workflows, deps.runs)

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

  router.register("workspaces", "map", {
    input: mapInput,
    output: WorkspaceMapPageSchema,
    handle: (i) => workspaceMap.map(i.workspaceId, {
      ...(i.collectionId !== undefined ? { collectionId: i.collectionId } : {}),
      limit: i.limit ?? WORKSPACE_MAP_DEFAULT_LIMIT,
      ...(i.cursor !== undefined ? { cursor: i.cursor } : {}),
    }),
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
