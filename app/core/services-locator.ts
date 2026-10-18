import { LocalOwnerProvider } from "./auth/LocalOwnerProvider"
import type { PermissionProvider } from "./auth/PermissionProvider"

/**
 * Singleton service-locator for cross-cutting seams.
 *
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
