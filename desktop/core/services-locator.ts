import { LocalOwnerProvider } from "./auth/LocalOwnerProvider"
import type { PermissionProvider } from "./auth/PermissionProvider"
import { LocalOnlySyncProvider } from "./sync/LocalOnlySyncProvider"
import type { SyncProvider } from "./sync/SyncProvider"

/**
 * Singleton service-locator for cross-cutting seams. Services in Wave 3+
 * obtain collaborators (currently only `SyncProvider`, with more expected
 * as IPC / scheduler land) via DI through this file instead of importing
 * concrete implementations directly.
 *
 * The default `SyncProvider` is the no-op `LocalOnlySyncProvider`; a future
 * cloud-sync provider replaces it via `setSyncProvider(...)` at bootstrap
 * without branching services.
 */
let syncProvider: SyncProvider | undefined

export function getSyncProvider(): SyncProvider {
  if (syncProvider === undefined) {
    syncProvider = new LocalOnlySyncProvider()
  }
  return syncProvider
}

export function setSyncProvider(provider: SyncProvider): void {
  syncProvider = provider
}

export function resetSyncProvider(): void {
  syncProvider = undefined
}

/**
 * The default `PermissionProvider` is the always-allow `LocalOwnerProvider`; a
 * future cloud/teams provider replaces it via `setPermissionProvider(...)` at
 * bootstrap without branching services.
 */
let permissionProvider: PermissionProvider | undefined

export function getPermissionProvider(): PermissionProvider {
  if (permissionProvider === undefined) {
    permissionProvider = new LocalOwnerProvider()
  }
  return permissionProvider
}

export function setPermissionProvider(provider: PermissionProvider): void {
  permissionProvider = provider
}

export function resetPermissionProvider(): void {
  permissionProvider = undefined
}
