/**
 * The OS keychain as a {@link KeyProtector} for the secrets keyfile.
 *
 * `safeStorage` is main-process only and must be asked after `app.whenReady`.
 * On Linux without a keyring, `safeStorage` "encrypts" with a hardcoded key, which protects
 * nothing — so there, as where encryption is unavailable at all, the keyfile
 * stays plaintext and this says why.
 */

import { safeStorage } from "electron"
import type { KeyProtector } from "../core/secrets/keyfile"

/** The keychain-backed protector, or `null` with the reason it is unavailable. */
export function osKeyProtector(): { readonly protector: KeyProtector } | { readonly protector: null; readonly reason: string } {
  if (!safeStorage.isEncryptionAvailable()) {
    return { protector: null, reason: "the operating system keychain is unavailable" }
  }
  if (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text") {
    return { protector: null, reason: "no system keyring (GNOME Keyring or KWallet) is running" }
  }
  return {
    protector: {
      encrypt: (plain) => safeStorage.encryptString(plain.toString("base64")),
      decrypt: (sealed) => Buffer.from(safeStorage.decryptString(sealed), "base64"),
    },
  }
}
