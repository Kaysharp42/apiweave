import { z } from "zod"
import type { IpcRouter } from "../router"
import { NotFoundError } from "../errors"
import type { HandlerDeps } from "./common"
import { NoInput } from "./common"

const stateSchema = z.enum(["idle", "syncing", "conflict", "error"])
const workspaceCatalogEntrySchema = z
  .object({
    workspaceId: z.string().min(1),
    workspaceName: z.string().min(1),
    teamId: z.string().min(1).optional(),
    teamName: z.string().min(1).optional(),
    isPersonal: z.boolean(),
    effectiveRole: z.number().int().min(0).max(5),
    canPull: z.boolean(),
    canPush: z.boolean(),
    canResolveConflicts: z.boolean(),
  })
  .strict()
const statusSchema = z
  .object({
    linked: z.boolean(),
    active: z.boolean(),
    state: stateSchema,
    deadLetterCount: z.number().int().nonnegative(),
    deviceId: z.string().optional(),
    workspaceIds: z.array(z.string()),
    workspaceCatalog: z.array(workspaceCatalogEntrySchema),
  })
  .strict()

const linkInput = z
  .object({
    deviceLabel: z.string().min(1).optional(),
  })
  .strict()

const bindWorkspaceInput = z
  .object({
    workspaceId: z.string().min(1),
    cloudWorkspaceId: z.string().min(1),
    teamId: z.string().min(1).nullable().optional(),
    syncMode: z.string().min(1).optional(),
  })
  .strict()

export function registerCloudHandlers(router: IpcRouter, deps: HandlerDeps): void {
  const control = deps.cloud

  router.register("cloud", "status", {
    input: NoInput,
    output: statusSchema,
    handle: () => required(control).status(),
  })

  router.register("cloud", "link", {
    input: linkInput,
    output: statusSchema,
    handle: (input) => required(control).link(input),
  })

  router.register("cloud", "cancelLink", {
    input: NoInput,
    output: statusSchema,
    handle: () => required(control).cancelLink(),
  })

  router.register("cloud", "unlink", {
    input: NoInput,
    output: statusSchema,
    handle: () => required(control).unlink(),
  })

  router.register("cloud", "bindWorkspace", {
    input: bindWorkspaceInput,
    output: statusSchema,
    handle: (input) => required(control).bindWorkspace(input),
  })

  router.register("cloud", "pull", {
    input: NoInput,
    output: statusSchema,
    handle: () => required(control).pull(),
  })

  router.register("cloud", "push", {
    input: NoInput,
    output: statusSchema,
    handle: () => required(control).push(),
  })
}

function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new NotFoundError("Cloud sync is not available in this process")
  }
  return value
}
