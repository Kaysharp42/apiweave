import { z } from "zod"
import type { Environment } from "@shared/types/Environment"
import { EnvironmentSchema, JsonValueSchema } from "@shared/zod-schemas"
import type { IpcRouter } from "../router"
import type { HandlerDeps } from "./common"
import { listResult } from "./common"

const ws = z.string().min(1)

// `secrets` is deliberately absent here: it's a legacy passthrough on the
// Environment record, superseded by the write-only `secrets` IPC domain
// (sealed-box storage, metadata-only reads). Accepting/returning it here would
// let plaintext or ciphertext bypass that boundary — see stripSecrets below.
const mutableFields = {
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  swaggerDocUrl: z.string().nullable().optional(),
  variables: z.record(z.string(), JsonValueSchema).optional(),
  isDefault: z.boolean().optional(),
}

/** Never return the legacy `secrets` field over IPC/MCP reads — see mutableFields note above. */
function stripSecrets(environment: Environment): Environment {
  return { ...environment, secrets: {} }
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
    handle: async ({ workspaceId, ...input }) => stripSecrets(await environments.create(workspaceId, input)),
  })

  router.register("environments", "get", {
    input: idInput,
    output: EnvironmentSchema,
    handle: async (i) => stripSecrets(await environments.get(i.workspaceId, i.environmentId)),
  })

  router.register("environments", "list", {
    input: z.object({ workspaceId: ws }).strict(),
    output: listResult(EnvironmentSchema),
    handle: async (i) => {
      const { items, total } = await environments.list(i.workspaceId)
      return { items: items.map(stripSecrets), total }
    },
  })

  router.register("environments", "update", {
    input: updateInput,
    output: EnvironmentSchema,
    handle: async ({ workspaceId, environmentId, ...patch }) =>
      stripSecrets(await environments.update(workspaceId, environmentId, patch)),
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
    handle: async (i) => stripSecrets(await environments.setVariable(i.workspaceId, i.environmentId, i.name, i.value)),
  })

  router.register("environments", "deleteVariable", {
    input: z
      .object({ workspaceId: ws, environmentId: z.string().min(1), name: z.string().min(1) })
      .strict(),
    output: EnvironmentSchema,
    handle: async (i) => stripSecrets(await environments.deleteVariable(i.workspaceId, i.environmentId, i.name)),
  })
}
