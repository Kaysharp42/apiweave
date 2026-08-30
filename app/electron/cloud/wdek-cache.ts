/**
 * Per-workspace WDEK cache, so the E2EE passphrase is not retyped every launch.
 *
 * The WDEK itself is key material, so it is never stored as-is: it goes through
 * Electron's `safeStorage`, which hands it to the OS keychain (macOS Keychain,
 * Windows DPAPI, libsecret/kwallet on Linux). `safeStorage` is main-process only,
 * which is why this lives here and not in `core/secrets/workspace_key.ts` — that
 * file stays pure `node:crypto`, this one owns storage.
 *
 * SECURITY: on Linux `safeStorage` falls back to a `basic_text` backend when no
 * keyring is available, "encrypting" with a hardcoded key — that is obfuscation,
 * not protection. We refuse to cache there and say why; the caller falls back to
 * asking for the passphrase each launch, which still works.
 */

import { safeStorage } from "electron"
import type { AppSettingsRepository } from "../../core/repositories"
import { DEK_SIZE } from "../../core/secrets/crypto"

const KEY_PREFIX = "cloud.e2ee.wdek."

function settingKey(workspaceId: string): string {
  return `${KEY_PREFIX}${workspaceId}`
}

/**
 * Why the OS cannot safely hold a key right now, or `null` when it can.
 * Exposed so callers can explain the passphrase prompt instead of just showing it.
 */
export function wdekCacheUnavailableReason(): string | null {
  if (!safeStorage.isEncryptionAvailable()) {
    return "The operating system keychain is unavailable, so the workspace key cannot be stored securely."
  }
  if (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text") {
    return "No system keyring (GNOME Keyring or KWallet) is running, so the workspace key would be stored with a well-known key that offers no protection."
  }
  return null
}

/**
 * Cache `wdek` for `workspaceId`. Returns `null` when cached, or the reason it
 * was refused — never throws on an untrustworthy backend, the passphrase-every-
 * launch path stays usable.
 */
export function cacheWdek(
  settings: AppSettingsRepository,
  workspaceId: string,
  wdek: Uint8Array,
): string | null {
  const reason = wdekCacheUnavailableReason()
  if (reason !== null) return reason
  const sealed = safeStorage.encryptString(Buffer.from(wdek).toString("base64"))
  settings.set(settingKey(workspaceId), sealed.toString("base64"))
  return null
}

/** The cached WDEK, or `undefined` if absent or no longer decryptable (prompt instead). */
export function readCachedWdek(
  settings: AppSettingsRepository,
  workspaceId: string,
): Uint8Array | undefined {
  const stored = settings.get(settingKey(workspaceId))
  if (stored === undefined) return undefined
  if (wdekCacheUnavailableReason() !== null) return undefined
  try {
    const wdek = Buffer.from(safeStorage.decryptString(Buffer.from(stored, "base64")), "base64")
    return wdek.length === DEK_SIZE ? wdek : undefined
  } catch {
    // Keychain reset, different OS user, corrupt row — fall back to the passphrase.
    return undefined
  }
}

/** Forget the cached WDEK (unlink, passphrase change, "lock this workspace"). */
export function clearCachedWdek(settings: AppSettingsRepository, workspaceId: string): void {
  settings.delete(settingKey(workspaceId))
}
