import { z } from "zod"
import type { IpcRouter } from "../router"
import { ConflictError, NotFoundError } from "../errors"
import type { HandlerDeps } from "./common"
import { NoInput } from "./common"
import {
  CloudAccountIdentityRequiredError,
  CloudAccountMismatchError,
  CloudUnlinkRequiresConfirmationError,
} from "../../services/cloud_sync_control"

const linkStateSchema = z.enum(["unlinked", "linking", "linked", "authenticationRequired"])
const stateSchema = z.enum(["idle", "initializing", "syncing", "conflict", "error", "offline"])
const workspaceCatalogEntrySchema = z
  .object({
    workspaceId: z.string().min(1),
    workspaceName: z.string().min(1),
    teamId: z.string().min(1).optional(),
    teamName: z.string().min(1).optional(),
    isPersonal: z.boolean(),
    effectiveRole: z.number().int().nonnegative(),
    canPull: z.boolean(),
    canPush: z.boolean(),
    canResolveConflicts: z.boolean(),
  })
  .strict()
const accountSchema = z.object({
  accountId: z.string().min(1),
  email: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
}).strict()
const deviceSchema = z.object({
  deviceId: z.string().min(1),
  label: z.string().min(1),
  clientVersion: z.string().min(1),
  createdAt: z.string().min(1),
}).strict()
const bindingSchema = z.object({
  workspaceId: z.string().min(1),
  workspaceName: z.string().min(1),
  cloudWorkspaceId: z.string().min(1),
  cloudWorkspaceName: z.string(),
  teamId: z.string().min(1).optional(),
  teamName: z.string().min(1).optional(),
  syncMode: z.string().min(1),
  initializationState: z.enum(["pulling", "pushing", "initialized"]),
  pendingCount: z.number().int().nonnegative(),
  deadLetterCount: z.number().int().nonnegative(),
  conflictCount: z.number().int().nonnegative(),
  boundAt: z.string().min(1),
  lastSyncedAt: z.string().min(1).optional(),
  initializedAt: z.string().min(1).optional(),
  lastError: z.string().min(1).optional(),
}).strict()
const statusSchema = z
  .object({
    linked: z.boolean(),
    active: z.boolean(),
    linkState: linkStateSchema,
    syncState: stateSchema,
    state: stateSchema,
    pendingCount: z.number().int().nonnegative(),
    deadLetterCount: z.number().int().nonnegative(),
    conflictCount: z.number().int().nonnegative(),
    lastSyncedAt: z.string().min(1).optional(),
    lastError: z.string().min(1).optional(),
    deviceId: z.string().optional(),
    device: deviceSchema.optional(),
    account: accountSchema.optional(),
    workspaceIds: z.array(z.string()),
    bindings: z.array(bindingSchema),
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
    syncMode: z.enum(["push", "bi-directional"]).optional(),
  })
  .strict()

const unlinkInput = z
  .object({
    localOnly: z.boolean().optional(),
  })
  .strict()

const unbindWorkspaceInput = z.object({ workspaceId: z.string().min(1) }).strict()
const initializeWorkspaceInput = z.object({ workspaceId: z.string().min(1) }).strict()
const deadLetterInput = z.object({ workspaceId: z.string().min(1) }).strict()

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
    handle: async (input) => {
      try {
        return await required(control).link(input)
      } catch (error) {
        if (error instanceof CloudAccountMismatchError || error instanceof CloudAccountIdentityRequiredError) {
          throw new ConflictError(error.message, {
            accountMismatch: error instanceof CloudAccountMismatchError,
            accountIdentityRequired: error instanceof CloudAccountIdentityRequiredError,
          })
        }
        throw error
      }
    },
  })

  router.register("cloud", "cancelLink", {
    input: NoInput,
    output: statusSchema,
    handle: () => required(control).cancelLink(),
  })

  router.register("cloud", "unlink", {
    input: unlinkInput,
    output: statusSchema,
    handle: async (input) => {
      try {
        return await required(control).unlink(input)
      } catch (error) {
        if (error instanceof CloudUnlinkRequiresConfirmationError) {
          throw new ConflictError(error.message, { localOnlyConfirmationRequired: true })
        }
        throw error
      }
    },
  })

  router.register("cloud", "bindWorkspace", {
    input: bindWorkspaceInput,
    output: statusSchema,
    handle: (input) => required(control).bindWorkspace(input),
  })

  router.register("cloud", "unbindWorkspace", {
    input: unbindWorkspaceInput,
    output: statusSchema,
    handle: (input) => required(control).unbindWorkspace(input),
  })

  router.register("cloud", "initializeWorkspace", {
    input: initializeWorkspaceInput,
    output: statusSchema,
    handle: (input) => required(control).initializeWorkspace(input),
  })

  router.register("cloud", "refreshWorkspaceCatalog", {
    input: NoInput,
    output: statusSchema,
    handle: () => required(control).refreshWorkspaceCatalog(),
  })

  router.register("cloud", "retryDeadLetters", {
    input: deadLetterInput,
    output: statusSchema,
    handle: (input) => required(control).retryDeadLetters(input),
  })

  router.register("cloud", "discardDeadLetters", {
    input: deadLetterInput,
    output: statusSchema,
    handle: (input) => required(control).discardDeadLetters(input),
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
