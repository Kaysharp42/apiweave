/**
 * Bidirectional workspace reconciliation.
 *
 * On link and on "check for new workspaces", the desktop diffs its local
 * workspaces against the cloud catalog and makes them agree, with no manual
 * binding step:
 *
 *   | Case                          | Action                                        |
 *   |-------------------------------|-----------------------------------------------|
 *   | local Personal ↔ cloud Personal | bind the pair (ids differ) → bidirectional sync |
 *   | local-only, non-personal      | provision cloud (personal team) → bind → push |
 *   | cloud-only                    | create local row keyed by cloud id → pull     |
 *   | already bound                 | leave (normal incremental sync)               |
 *   | owned by another account      | leave local and untouched (never pushed)      |
 *
 * The reconciler is idempotent: already-bound pairs are skipped, provisioning
 * is idempotent server-side, and cloud-only rows are created with
 * `localId == cloudId` so a re-run finds them already bound.
 *
 * Ownership: a workspace that previously synced carries the account id it
 * synced with, and that stamp survives Disconnect. Only unstamped workspaces
 * (never synced) and workspaces stamped with the linking account are claimable.
 * Without this, a kept local Personal workspace would match the next account's
 * cloud Personal on the isPersonal flag alone and push the previous account's
 * workflows into it. The other account's cloud Personal is still downloaded —
 * it just arrives as its own local workspace instead of taking over this one.
 *
 * ENCRYPTION: a workspace this reconciler *creates* server-side commits its
 * encryption mode forever (the server enforces write-once), so provisioning is
 * gated on an explicit decision — see {@link ReconcilerEncryptionPlan}. A
 * workspace that already exists in the cloud carries its own mode in the
 * catalog and is bound with it; `unspecified` there means "we do not know",
 * which is treated as locked, never as plaintext.
 */

import type {
  CloudWorkspaceCatalogEntry,
  WorkspaceEncryptionMode,
} from "../../core/services/cloud_sync_control"
import type { WorkspaceEncryptionBundle } from "./workspace-encryption"

// fallow-ignore-next-line code-duplication
export interface ReconcilerLocalWorkspace {
  readonly workspaceId: string
  readonly name: string
  readonly slug: string
  readonly isPersonal: boolean
  /** Account this workspace last synced with; undefined when it never has. */
  readonly ownerAccountId?: string
}

/**
 * The slice of the cloud workspace catalog this reconciler needs. Derived from
 * {@link CloudWorkspaceCatalogEntry} rather than redeclared, because the caller
 * passes its catalog straight in — a second copy of the field list would drift.
 *
 * `encryptionMode` is optional there because catalogs persisted before E2EE
 * existed have no such field, and absent reads as `"unspecified"`: locked,
 * never plaintext.
 */
export type ReconcilerCatalogEntry = Pick<
  CloudWorkspaceCatalogEntry,
  "workspaceId" | "workspaceName" | "teamId" | "teamName" | "isPersonal" | "canPull" | "canPush" | "encryptionMode"
>

/**
 * What to do about encryption for a local workspace that has never been
 * provisioned. `pending` means nobody has been asked yet: the workspace is NOT
 * provisioned, because the server's `encryption_mode` is write-once and a
 * plaintext row can never be upgraded afterwards.
 */
export type ReconcilerEncryptionPlan =
  | { readonly mode: "e2ee"; readonly bundle: WorkspaceEncryptionBundle }
  | { readonly mode: "none" }
  | { readonly mode: "pending" }

export interface ReconcilerBindInput {
  readonly workspaceId: string
  readonly cloudWorkspaceId: string
  readonly cloudWorkspaceName: string
  readonly teamId?: string
  readonly teamName?: string
  readonly recordBaseline: boolean
  /**
   * The mode the SERVER reports for this workspace — off the provisioning
   * response, not off what we asked for. `EnsureSyncWorkspace` silently ignores
   * an `encryption` bundle on a workspace that already exists, so assuming our
   * bundle was applied is exactly how a workspace ends up pushing plaintext
   * under a key nobody holds.
   */
  readonly encryptionMode: WorkspaceEncryptionMode
}

// fallow-ignore-next-line code-duplication
export interface ReconcilerDeps {
  /** The cloud account currently linked — the only account allowed to claim. */
  readonly accountId: string
  listLocalWorkspaces(): readonly ReconcilerLocalWorkspace[]
  listBoundPairs(): readonly { readonly workspaceId: string; readonly cloudWorkspaceId: string }[]
  catalog(): readonly ReconcilerCatalogEntry[]
  /** The encryption decision recorded for a local workspace that is not yet provisioned. */
  encryptionPlan(workspaceId: string): ReconcilerEncryptionPlan
  ensureSyncWorkspace(input: {
    workspaceId: string
    name: string
    slug: string
    isPersonal: boolean
    encryption?: WorkspaceEncryptionBundle
  }): Promise<ReconcilerCatalogEntry>
  createLocalFromCloud(input: {
    id: string
    name: string
    slug: string
    isPersonal: boolean
    origin: "cloud" | "team"
  }): void
  bind(input: ReconcilerBindInput): void
  reactivate(): void
  initializeWorkspace(workspaceId: string): Promise<void>
  log(message: string, data?: Record<string, unknown>): void
}

/**
 * Reconcile local ↔ cloud workspaces. Provisioning and binding are awaited so
 * the caller's status reflects the new bindings; per-workspace initial sync
 * (pull/push) is kicked off in the background and reports its own errors.
 * Per-workspace failures are isolated so one bad workspace can't abort the rest.
 */
export async function reconcileWorkspaces(deps: ReconcilerDeps): Promise<void> {
  const boundLocal = new Set<string>()
  const boundCloud = new Set<string>()
  for (const pair of deps.listBoundPairs()) {
    boundLocal.add(pair.workspaceId)
    boundCloud.add(pair.cloudWorkspaceId)
  }

  const locals = deps.listLocalWorkspaces()
  const catalog = deps.catalog()
  const toInitialize: string[] = []

  // A workspace is claimable when it has never synced, or last synced with the
  // account linking now. Anything else belongs to a different account: leave it
  // local, never bind it, never push it.
  const isClaimable = (workspace: ReconcilerLocalWorkspace): boolean => {
    if (workspace.ownerAccountId === undefined || workspace.ownerAccountId === deps.accountId) {
      return true
    }
    deps.log("reconcile skipped workspace owned by another account", {
      workspaceId: workspace.workspaceId,
    })
    return false
  }

  // Bind a local workspace to the cloud row it pairs with, provisioning one
  // first when `paired` is omitted, and queue its first sync. Cases 1 and 2
  // differ only in whether a cloud row already exists; failures (including a
  // pending encryption decision) are isolated per workspace so one bad
  // workspace cannot abort the pass.
  const bindOrProvision = async (
    local: ReconcilerLocalWorkspace,
    paired?: Pairing,
  ): Promise<void> => {
    try {
      const target = paired ?? await provision(deps, local)
      deps.bind({
        workspaceId: local.workspaceId,
        cloudWorkspaceId: target.workspaceId,
        cloudWorkspaceName: target.workspaceName,
        recordBaseline: true,
        encryptionMode: target.encryptionMode,
      })
      boundCloud.add(target.workspaceId)
      boundLocal.add(local.workspaceId)
      toInitialize.push(local.workspaceId)
    } catch (error) {
      deps.log("reconcile skipped workspace", { workspaceId: local.workspaceId, reason: String(error) })
    }
  }

  // 1. Personal: pair the local personal workspace with the cloud one (ids
  //    differ — cloud minted its own at signup). If the cloud has no personal
  //    entry, provision one keyed to the local id.
  const localPersonal = locals.find(
    (workspace) => workspace.isPersonal && isClaimable(workspace),
  )
  if (localPersonal !== undefined && !boundLocal.has(localPersonal.workspaceId)) {
    // Pairing with an existing cloud row inherits that row's mode; only the
    // provisioning arm creates a row, and only that arm is gated.
    const cloudPersonal = catalog.find(
      (entry) => entry.isPersonal && !boundCloud.has(entry.workspaceId),
    )
    await bindOrProvision(
      localPersonal,
      cloudPersonal === undefined ? undefined : toPairing(cloudPersonal),
    )
  }

  // 2. Local-only, non-personal: provision into the personal team, then push.
  for (const local of locals) {
    if (local.isPersonal || boundLocal.has(local.workspaceId) || !isClaimable(local)) {
      continue
    }
    await bindOrProvision(local)
  }

  // 3. Cloud-only: download as a new local workspace keyed by the cloud id.
  for (const entry of catalog) {
    if (boundCloud.has(entry.workspaceId) || !entry.canPull) {
      continue
    }
    // A shared-team workspace is labelled "team"; the user's own (personal or
    // provisioned) workspaces are "cloud".
    // ponytail: a workspace provisioned into the personal team from another
    // device reads as "team" here — cosmetic only, sync behaviour is unaffected.
    const origin = !entry.isPersonal && entry.teamId !== undefined ? "team" : "cloud"
    try {
      deps.createLocalFromCloud({
        id: entry.workspaceId,
        name: entry.workspaceName,
        slug: entry.workspaceId,
        isPersonal: entry.isPersonal,
        origin,
      })
      deps.bind({
        workspaceId: entry.workspaceId,
        cloudWorkspaceId: entry.workspaceId,
        cloudWorkspaceName: entry.workspaceName,
        ...(origin === "team" && entry.teamId !== undefined ? { teamId: entry.teamId } : {}),
        ...(origin === "team" && entry.teamName !== undefined ? { teamName: entry.teamName } : {}),
        recordBaseline: false,
        encryptionMode: toPairing(entry).encryptionMode,
      })
      boundCloud.add(entry.workspaceId)
      toInitialize.push(entry.workspaceId)
    } catch (error) {
      deps.log("reconcile download failed", { cloudWorkspaceId: entry.workspaceId, error: String(error) })
    }
  }

  if (toInitialize.length === 0) {
    return
  }

  // Rebuild the provider so its config includes the new bindings, then drive
  // each initial sync in the background.
  deps.reactivate()
  for (const workspaceId of toInitialize) {
    void deps.initializeWorkspace(workspaceId).catch(() => undefined)
  }
}

interface Pairing {
  readonly workspaceId: string
  readonly workspaceName: string
  readonly encryptionMode: WorkspaceEncryptionMode
}

/** A catalog entry with no mode predates E2EE: unknown, and therefore locked. */
function toPairing(entry: ReconcilerCatalogEntry): Pairing {
  return {
    workspaceId: entry.workspaceId,
    workspaceName: entry.workspaceName,
    encryptionMode: entry.encryptionMode ?? "unspecified",
  }
}

/**
 * Nobody has said whether this workspace should be encrypted, so it is not
 * provisioned — the gate. Thrown rather than returned so it rides the
 * per-workspace catch each case already has: nothing is bound, nothing is
 * queued, and the rest of the pass carries on.
 */
export class EncryptionDecisionPending extends Error {
  public constructor(workspaceId: string) {
    super(`Workspace ${workspaceId} is waiting for an encryption decision, so it was not provisioned.`)
    this.name = "EncryptionDecisionPending"
  }
}

/** Provision a cloud row for a local workspace, once its encryption decision is made. */
async function provision(deps: ReconcilerDeps, local: ReconcilerLocalWorkspace): Promise<Pairing> {
  const plan = deps.encryptionPlan(local.workspaceId)
  if (plan.mode === "pending") {
    throw new EncryptionDecisionPending(local.workspaceId)
  }
  return toPairing(await deps.ensureSyncWorkspace({
    workspaceId: local.workspaceId,
    name: local.name,
    slug: local.slug,
    isPersonal: local.isPersonal,
    ...(plan.mode === "e2ee" ? { encryption: plan.bundle } : {}),
  }))
}
