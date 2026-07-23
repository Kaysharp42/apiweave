import { z } from "zod"
import type { IpcRouter } from "../router"
import type { HandlerDeps } from "./common"

const ws = z.string().min(1)
const scopeType = z.enum(["environment", "workspace"])

/** Metadata-only — write-only surface, so NO sealed bytes or plaintext ever appears here. */
const SecretMetadataSchema = z
  .object({
    secretId: z.string().min(1),
    name: z.string().min(1),
    scopeType,
    scopeId: z.string().min(1),
    keyId: z.string().min(1),
    label: z.string().optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict()

const ResolvedSecretSchema = z
  .object({ metadata: SecretMetadataSchema, resolvedScope: scopeType })
  .strict()

const SecretPublicKeySchema = z
  .object({
    keyId: z.string().min(1),
    publicKey: z.string().min(1),
    algorithm: z.literal("libsodium-sealed-box"),
  })
  .strict()

const scopeInput = z.object({ workspaceId: ws, scopeType, scopeId: z.string().min(1) }).strict()

export function registerSecretHandlers(router: IpcRouter, deps: HandlerDeps): void {
  const { secrets } = deps

  router.register("secrets", "set", {
    input: z
      .object({
        workspaceId: ws,
        name: z.string().min(1),
        scopeType,
        scopeId: z.string().min(1),
        keyId: z.string().min(1),
        sealed: z.instanceof(Uint8Array),
        label: z.string().optional(),
      })
      .strict(),
    output: SecretMetadataSchema,
    handle: ({ workspaceId, ...input }) => secrets.set(workspaceId, input),
  })

  router.register("secrets", "publicKey", {
    input: scopeInput,
    output: SecretPublicKeySchema,
    handle: (i) => secrets.publicKey(i.workspaceId, i.scopeType, i.scopeId),
  })

  router.register("secrets", "list", {
    input: scopeInput,
    output: z.array(SecretMetadataSchema),
    handle: (i) => secrets.list(i.workspaceId, i.scopeType, i.scopeId),
  })

  router.register("secrets", "delete", {
    input: z.object({ workspaceId: ws, scopeType, scopeId: z.string().min(1), name: z.string().min(1) }).strict(),
    output: z.null(),
    handle: async (i) => {
      await secrets.delete(i.workspaceId, i.scopeType, i.scopeId, i.name)
      return null
    },
  })

  router.register("secrets", "resolve", {
    input: z
      .object({
        workspaceId: ws,
        chain: z
          .object({ environmentId: z.string().min(1).optional(), workspaceId: z.string().min(1).optional() })
          .strict(),
        name: z.string().min(1),
      })
      .strict(),
    output: ResolvedSecretSchema.nullable(),
    handle: (i) => secrets.resolve(i.workspaceId, i.chain, i.name),
  })
}
