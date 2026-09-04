import { z } from "zod"
import { WorkspaceSchema } from "@shared/zod-schemas"
import { MIN_PASSPHRASE_LENGTH } from "@shared/passphrase"
import type { IpcRouter } from "../router"
import { ConflictError, DeniedError, NotFoundError } from "../errors"
import type { HandlerDeps } from "./common"
import { NoInput } from "./common"
import {
  CloudAccountIdentityRequiredError,
  CloudAccountMismatchError,
  CloudUnlinkRequiresConfirmationError,
  CloudWorkspaceEncryptionInvalidError,
  CloudWorkspaceEncryptionSettledError,
  CloudWorkspaceLockedError,
  CloudWorkspaceOwnedByAnotherAccountError,
  CloudWorkspacePassphraseAdminOnlyError,
  CloudWorkspacePassphraseIncorrectError,
  type CloudSyncStatus,
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
    encryptionMode: z.enum(["unspecified", "none", "e2ee"]).optional(),
  })
  .strict()
const teamCatalogEntrySchema = z.object({
  teamId: z.string().min(1),
  teamName: z.string().min(1),
  isPersonal: z.boolean(),
  canCreateWorkspaces: z.boolean(),
}).strict()
const accountSchema = z.object({
  accountId: z.string().min(1),
  email: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
  avatarUrl: z.string().min(1).optional(),
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
  encryption: z.enum(["plaintext", "unlocked", "locked", "unknown"]),
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
    teamCatalog: z.array(teamCatalogEntrySchema),
    encryptionDecisionPending: z.array(
      z.object({ workspaceId: z.string().min(1), workspaceName: z.string() }).strict(),
    ),
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

/** Every route that SETS a passphrase shares one floor. See the note below. */
const newPassphrase = z.string().min(MIN_PASSPHRASE_LENGTH)

const createTeamWorkspaceInput = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().min(1),
  description: z.string().trim().max(500).nullable().optional(),
  teamId: z.string().min(1).optional(),
  newTeamName: z.string().trim().min(1).max(80).optional(),
  // A Team workspace's only chance to be encrypted: a weak one here is permanent.
  passphrase: newPassphrase.optional(),
}).strict().superRefine((input, ctx) => {
  if ((input.teamId === undefined) === (input.newTeamName === undefined)) {
    ctx.addIssue({
      code: "custom",
      message: "Choose an existing Team or enter a new Team name",
      path: ["teamId"],
    })
  }
})

const unlinkInput = z
  .object({
    localOnly: z.boolean().optional(),
    purgeLocalData: z.boolean().optional(),
  })
  .strict()

const unbindWorkspaceInput = z.object({ workspaceId: z.string().min(1) }).strict()
const workspaceRefInput = z.object({ workspaceId: z.string().min(1) }).strict()
// The passphrase never leaves the main process after this point: it is stretched
// into a KEK and discarded. The length floor IS enforced here, because here is
// the trust boundary: the renderer's floor only governs the renderer, and any
// other IPC caller could otherwise commit a workspace to a one-character
// passphrase permanently.
const workspacePassphraseInput = z
  .object({ workspaceId: z.string().min(1), passphrase: newPassphrase })
  .strict()
// Unlocking VERIFIES a passphrase the workspace already has rather than setting
// one, so it takes whatever that workspace was created with. A floor here would
// lock a workspace out, not protect it.
const unlockWorkspaceInput = z
  .object({ workspaceId: z.string().min(1), passphrase: z.string().min(1) })
  .strict()
const initializeWorkspaceInput = z.object({ workspaceId: z.string().min(1) }).strict()
const deadLetterInput = z.object({ workspaceId: z.string().min(1) }).strict()
const failedRecordsSchema = z.array(
  z.object({
    outboxId: z.string().min(1),
    kind: z.string().min(1),
    recordId: z.string().min(1),
    recordName: z.string().min(1).optional(),
    op: z.string().min(1),
    failureReason: z.string().min(1).optional(),
    attempts: z.number().int().nonnegative(),
    queuedAt: z.string().min(1),
  }).strict(),
)

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

  // Every domain action in this router follows the same
  // router.register(domain, action, { input, output, handle }) shape; this
  // one additionally maps a domain error the way `link`/`unlink` above do.
  // fallow-ignore-next-line code-duplication
  router.register("cloud", "bindWorkspace", {
    input: bindWorkspaceInput,
    output: statusSchema,
    handle: async (input) => {
      try {
        return await required(control).bindWorkspace(input)
      } catch (error) {
        if (error instanceof CloudWorkspaceOwnedByAnotherAccountError) {
          throw new ConflictError(error.message, { workspaceOwnedByAnotherAccount: true })
        }
        throw error
      }
    },
  })

  router.register("cloud", "createTeamWorkspace", {
    input: createTeamWorkspaceInput,
    output: WorkspaceSchema,
    handle: (input) => required(control).createTeamWorkspace(input),
  })

  router.register("cloud", "setWorkspaceEncryption", {
    input: workspacePassphraseInput,
    output: statusSchema,
    handle: (input) => encryptionErrors(() => required(control).setWorkspaceEncryption(input)),
  })

  router.register("cloud", "declineWorkspaceEncryption", {
    input: workspaceRefInput,
    output: statusSchema,
    handle: (input) => encryptionErrors(() => required(control).declineWorkspaceEncryption(input)),
  })

  router.register("cloud", "unlockWorkspace", {
    input: unlockWorkspaceInput,
    output: statusSchema,
    handle: (input) => encryptionErrors(() => required(control).unlockWorkspace(input)),
  })

  router.register("cloud", "lockWorkspace", {
    input: workspaceRefInput,
    output: statusSchema,
    handle: (input) => required(control).lockWorkspace(input),
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

  router.register("cloud", "listFailedRecords", {
    input: deadLetterInput,
    output: failedRecordsSchema,
    handle: (input) => required(control).listFailedRecords(input),
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

/**
 * Map the encryption failures the renderer must tell apart into a ConflictError
 * with a discriminating detail flag. In particular a wrong passphrase has to be
 * distinguishable from a transport failure so the prompt can say "try again"
 * instead of "sync is broken".
 */
async function encryptionErrors(run: () => Promise<CloudSyncStatus>): Promise<CloudSyncStatus> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof CloudWorkspacePassphraseIncorrectError) {
      throw new ConflictError(error.message, { passphraseIncorrect: true })
    }
    if (error instanceof CloudWorkspaceLockedError) {
      throw new ConflictError(error.message, { workspaceLocked: true })
    }
    // "denied", not "conflict": this is the server refusing a caller, which is
    // exactly what the contract's 403 code is for — no state has to change for
    // the same request to succeed for someone else.
    if (error instanceof CloudWorkspacePassphraseAdminOnlyError) {
      throw new DeniedError(error.message, { passphraseAdminOnly: true })
    }
    if (error instanceof CloudWorkspaceEncryptionSettledError) {
      throw new ConflictError(error.message, { encryptionModeSettled: true })
    }
    if (error instanceof CloudWorkspaceEncryptionInvalidError) {
      throw new ConflictError(error.message, { encryptionSettingsInvalid: true })
    }
    throw error
  }
}

function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new NotFoundError("Cloud sync is not available in this process")
  }
  return value
}
