import { z } from "zod"
import type { IpcRouter } from "../router"
import { NotFoundError } from "../errors"
import type { HandlerDeps } from "./common"
import { NoInput } from "./common"

const stateSchema = z.enum(["idle", "syncing", "conflict", "error"])
const statusSchema = z
  .object({
    linked: z.boolean(),
    active: z.boolean(),
    state: stateSchema,
    deadLetterCount: z.number().int().nonnegative(),
    deviceId: z.string().optional(),
    workspaceIds: z.array(z.string()),
  })
  .strict()

const linkInput = z
  .object({
    zitadelIssuer: z.string().url().optional(),
    desktopClientId: z.string().min(1).optional(),
    apiBaseUrl: z.string().url().optional(),
    deviceLabel: z.string().min(1).optional(),
    workspaceIds: z.array(z.string().min(1)).optional(),
  })
  .strict()

const bindWorkspaceInput = z
  .object({
    workspaceId: z.string().min(1),
    cloudWorkspaceId: z.string().min(1).optional(),
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
