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
 *
 * The reconciler is idempotent: already-bound pairs are skipped, provisioning
 * is idempotent server-side, and cloud-only rows are created with
 * `localId == cloudId` so a re-run finds them already bound.
 */

export interface ReconcilerLocalWorkspace {
  readonly workspaceId: string
  readonly name: string
  readonly slug: string
  readonly isPersonal: boolean
}

export interface ReconcilerCatalogEntry {
  readonly workspaceId: string
  readonly workspaceName: string
  readonly teamId?: string
  readonly teamName?: string
  readonly isPersonal: boolean
  readonly canPull: boolean
  readonly canPush: boolean
}

export interface ReconcilerBindInput {
  readonly workspaceId: string
  readonly cloudWorkspaceId: string
  readonly cloudWorkspaceName: string
  readonly teamId?: string
  readonly teamName?: string
  readonly recordBaseline: boolean
}

export interface ReconcilerDeps {
  listLocalWorkspaces(): readonly ReconcilerLocalWorkspace[]
  listBoundPairs(): readonly { readonly workspaceId: string; readonly cloudWorkspaceId: string }[]
  catalog(): readonly ReconcilerCatalogEntry[]
  ensureSyncWorkspace(input: {
    workspaceId: string
    name: string
    slug: string
    isPersonal: boolean
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

  // 1. Personal: pair the local personal workspace with the cloud one (ids
  //    differ — cloud minted its own at signup). If the cloud has no personal
  //    entry, provision one keyed to the local id.
  const localPersonal = locals.find((workspace) => workspace.isPersonal)
  if (localPersonal !== undefined && !boundLocal.has(localPersonal.workspaceId)) {
    const cloudPersonal = catalog.find(
      (entry) => entry.isPersonal && !boundCloud.has(entry.workspaceId),
    )
    try {
      if (cloudPersonal !== undefined) {
        deps.bind({
          workspaceId: localPersonal.workspaceId,
          cloudWorkspaceId: cloudPersonal.workspaceId,
          cloudWorkspaceName: cloudPersonal.workspaceName,
          recordBaseline: true,
        })
        boundCloud.add(cloudPersonal.workspaceId)
      } else {
        const provisioned = await deps.ensureSyncWorkspace({
          workspaceId: localPersonal.workspaceId,
          name: localPersonal.name,
          slug: localPersonal.slug,
          isPersonal: true,
        })
        deps.bind({
          workspaceId: localPersonal.workspaceId,
          cloudWorkspaceId: provisioned.workspaceId,
          cloudWorkspaceName: provisioned.workspaceName,
          recordBaseline: true,
        })
        boundCloud.add(provisioned.workspaceId)
      }
      boundLocal.add(localPersonal.workspaceId)
      toInitialize.push(localPersonal.workspaceId)
    } catch (error) {
      deps.log("reconcile personal failed", { workspaceId: localPersonal.workspaceId, error: String(error) })
    }
  }

  // 2. Local-only, non-personal: provision into the personal team, then push.
  for (const local of locals) {
    if (local.isPersonal || boundLocal.has(local.workspaceId)) {
      continue
    }
    try {
      const provisioned = await deps.ensureSyncWorkspace({
        workspaceId: local.workspaceId,
        name: local.name,
        slug: local.slug,
        isPersonal: false,
      })
      deps.bind({
        workspaceId: local.workspaceId,
        cloudWorkspaceId: provisioned.workspaceId,
        cloudWorkspaceName: provisioned.workspaceName,
        recordBaseline: true,
      })
      boundLocal.add(local.workspaceId)
      boundCloud.add(provisioned.workspaceId)
      toInitialize.push(local.workspaceId)
    } catch (error) {
      deps.log("reconcile provision failed", { workspaceId: local.workspaceId, error: String(error) })
    }
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
