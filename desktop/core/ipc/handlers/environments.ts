import { z } from "zod"
import { EnvironmentSchema, JsonValueSchema } from "../../../../shared/zod-schemas"
import type { IpcRouter } from "../router"
import type { HandlerDeps } from "./common"
import { listResult } from "./common"

const ws = z.string().min(1)

const mutableFields = {
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  swaggerDocUrl: z.string().nullable().optional(),
  variables: z.record(z.string(), JsonValueSchema).optional(),
  secrets: z.record(z.string(), JsonValueSchema).optional(),
  isDefault: z.boolean().optional(),
}

const createInput = z.object({ workspaceId: ws, ...mutableFields }).strict()
const updateInput = z
  .object({ workspaceId: ws, environmentId: z.string().min(1), ...mutableFields })
  .partial({ name: true })
  .strict()

const idInput = z.object({ workspaceId: ws, environmentId: z.string().min(1) }).strict()

export function registerEnvironmentHandlers(router: IpcRouter, deps: HandlerDeps): void {
  const { environments } = deps

  router.register("environments", "create", {
    input: createInput,
    output: EnvironmentSchema,
    handle: ({ workspaceId, ...input }) => environments.create(workspaceId, input),
  })

  router.register("environments", "get", {
    input: idInput,
    output: EnvironmentSchema,
    handle: (i) => environments.get(i.workspaceId, i.environmentId),
  })

  router.register("environments", "list", {
    input: z.object({ workspaceId: ws }).strict(),
    output: listResult(EnvironmentSchema),
    handle: (i) => environments.list(i.workspaceId),
  })

  router.register("environments", "update", {
    input: updateInput,
    output: EnvironmentSchema,
    handle: ({ workspaceId, environmentId, ...patch }) =>
      environments.update(workspaceId, environmentId, patch),
  })

  router.register("environments", "delete", {
    input: idInput,
    output: z.null(),
    handle: async (i) => {
      await environments.delete(i.workspaceId, i.environmentId)
      return null
    },
  })

  router.register("environments", "setVariable", {
    input: z
      .object({ workspaceId: ws, environmentId: z.string().min(1), name: z.string().min(1), value: JsonValueSchema })
      .strict(),
    output: EnvironmentSchema,
    handle: (i) => environments.setVariable(i.workspaceId, i.environmentId, i.name, i.value),
  })

  router.register("environments", "deleteVariable", {
    input: z
      .object({ workspaceId: ws, environmentId: z.string().min(1), name: z.string().min(1) })
      .strict(),
    output: EnvironmentSchema,
    handle: (i) => environments.deleteVariable(i.workspaceId, i.environmentId, i.name),
  })
}
