/**
 * In-memory holder for unlocked workspace encryption keys.
 *
 * The transport needs exactly two facts per bound workspace: is it end-to-end
 * encrypted, and if so, is its WDEK unlocked right now. Both live here.
 *
 * It is a module singleton (same shape as `cloud-state.ts`) rather than state on
 * CloudSyncProvider because the provider is torn down and rebuilt on every
 * re-activation (`CloudSyncControl.activateIfReady`) — an unlock has to survive
 * that. Nothing here touches storage or the network: `wdek-cache.ts` owns the
 * OS keychain and `core/secrets/workspace_key.ts` owns the key math.
 *
 * Keyed by LOCAL workspace id, which is what `CloudWorkspaceBinding.workspaceId`
 * and `readCachedWdek` already use — never the cloud id.
 *
 * PHASE 4 fills this: at launch from `readCachedWdek`, and on a passphrase
 * prompt from `deriveKek` + `unwrapWdek`. A workspace the server reports as
 * `encryption_mode = 'e2ee'` must be registered here *before* the first sync
 * cycle, with `null` when its key is still locked — an unregistered workspace
 * is treated as plaintext, which is what the server expects for
 * `encryption_mode = 'none'`.
 */

/** Present => the workspace is e2ee. `null` => e2ee but still locked. */
const wdeks = new Map<string, Uint8Array | null>()

/** The workspace is end-to-end encrypted but its key has not been unlocked. */
export class WorkspaceLocked extends Error {
  constructor(workspaceId: string) {
    super(`Workspace ${workspaceId} is end-to-end encrypted and locked — its passphrase is needed to sync.`)
    this.name = "WorkspaceLocked"
  }
}

/** Register a workspace as e2ee. Pass the unwrapped WDEK, or `null` for locked. */
export function setWorkspaceEncryption(workspaceId: string, wdek: Uint8Array | null): void {
  wdeks.set(workspaceId, wdek)
}

/** Forget one workspace's key (lock/unlink), or all of them when called bare. */
export function clearWorkspaceEncryption(workspaceId?: string): void {
  if (workspaceId === undefined) {
    wdeks.clear()
    return
  }
  wdeks.delete(workspaceId)
}

/**
 * Whether an unlocked key is held right now. Never throws — this is for status
 * reporting; the sync path uses {@link workspaceWdek} so it cannot ignore a lock.
 */
export function hasWorkspaceKey(workspaceId: string): boolean {
  return (wdeks.get(workspaceId) ?? null) !== null
}

/**
 * The WDEK to seal/open this workspace's records with, or `null` when the
 * workspace is plaintext. Throws {@link WorkspaceLocked} when it is e2ee and
 * locked — callers must fail rather than fall back to plaintext.
 */
export function workspaceWdek(workspaceId: string): Uint8Array | null {
  if (!wdeks.has(workspaceId)) {
    return null
  }
  const wdek = wdeks.get(workspaceId) ?? null
  if (wdek === null) {
    throw new WorkspaceLocked(workspaceId)
  }
  return wdek
}
