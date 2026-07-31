import { z } from "zod"
import { JsonValueSchema, NodePresetNodeTypeSchema, NodePresetSchema } from "@shared/zod-schemas"
import type { IpcRouter } from "../router"
import type { HandlerDeps } from "./common"
import { listResult } from "./common"

const ws = z.string().min(1)

/**
 * `config` is accepted as an open JSON record here and narrowed to the
 * `nodeType`'s node-data schema by `NodePresetService` — which canonicalises
 * legacy KV shapes first, the same order `handlers/workflows.ts` uses for
 * `nodes`. Validating strictly at this boundary instead would reject the
 * legacy-but-legal input the canonicaliser exists to accept.
 */
const mutableFields = {
  name: z.string().min(1),
  nodeType: NodePresetNodeTypeSchema,
  config: z.record(z.string(), JsonValueSchema).optional(),
}

const createInput = z.object({ workspaceId: ws, ...mutableFields }).strict()
const updateInput = z
  .object({ workspaceId: ws, presetId: z.string().min(1), ...mutableFields })
  .partial({ name: true, nodeType: true })
  .strict()

const idInput = z.object({ workspaceId: ws, presetId: z.string().min(1) }).strict()

export function registerNodePresetHandlers(router: IpcRouter, deps: HandlerDeps): void {
  const { nodePresets } = deps

  router.register("nodePresets", "create", {
    input: createInput,
    output: NodePresetSchema,
    handle: ({ workspaceId, ...input }) => nodePresets.create(workspaceId, input),
  })

  router.register("nodePresets", "list", {
    input: z.object({ workspaceId: ws }).strict(),
    output: listResult(NodePresetSchema),
    handle: (i) => nodePresets.list(i.workspaceId),
  })

  router.register("nodePresets", "update", {
    input: updateInput,
    output: NodePresetSchema,
    handle: ({ workspaceId, presetId, ...patch }) => nodePresets.update(workspaceId, presetId, patch),
  })

  router.register("nodePresets", "delete", {
    input: idInput,
    output: z.null(),
    handle: async (i) => {
      await nodePresets.delete(i.workspaceId, i.presetId)
      return null
    },
  })
}
