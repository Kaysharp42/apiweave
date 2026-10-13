/**
 * Local keyfile — the root of the desktop secrets subsystem.
 *
 * Holds the master Key Encryption Key (KEK) that unwraps every per-scope DEK.
 * Stored as JSON under Electron's `userData` (path injected, so tests point at a
 * temp dir). The KEK itself is sealed by a {@link KeyProtector} — Electron's
 * `safeStorage`, i.e. the OS keychain — whenever one is available, so the file
 * beside the database is useless without the user's OS login. Without one
 * (Linux with no keyring) it is stored as-is and the caller warns. Per-scope keypairs live in the `scoped_keys` table, their private
 * keys wrapped by this KEK — lose the keyfile and every stored secret is orphaned.
 *
 * INVARIANT (ported from the strategy doc, Key Decision #4): NEVER regenerate the
 * KEK on a corrupt or unreadable keyfile. A missing keyfile is first-run only
 * when no sealed secret exists ({@link openKeyfile}), and only an explicit
 * {@link createKeyfile} may write one; a present-but-broken keyfile throws
 * {@link KeyfileCorrupted} loudly, and one the keychain will not open throws
 * {@link KeyfileLocked}. Silent regeneration would swap the KEK
 * and orphan every secret the user already stored — data loss disguised as recovery.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { DEK_SIZE } from "./crypto"

/** Plaintext KEK — written only when no {@link KeyProtector} is available. */
const PLAIN_VERSION = 1
/** KEK sealed by the OS keychain. */
const SEALED_VERSION = 2

/**
 * Seals and opens the KEK with OS-held key material. Injected so this module
 * stays free of `electron`; `null` means the OS cannot hold a key securely.
 */
export interface KeyProtector {
  readonly encrypt: (plain: Buffer) => Buffer
  readonly decrypt: (sealed: Buffer) => Buffer
}

/** Present-but-broken keyfile. NEVER auto-recovered — throwing preserves stored secrets. */
export class KeyfileCorrupted extends Error {
  constructor(path: string, reason: string) {
    super(`Keyfile at ${path} is corrupt (${reason}). Refusing to regenerate — that would orphan every stored secret.`)
    this.name = "KeyfileCorrupted"
  }
}

/** No keyfile present. First-run: call {@link createKeyfile} explicitly to bootstrap. */
export class KeyfileMissing extends Error {
  constructor(path: string, detail = "Call createKeyfile() to bootstrap first-run.") {
    super(`No keyfile at ${path}. ${detail}`)
    this.name = "KeyfileMissing"
  }
}

/**
 * The keyfile is sealed by the OS keychain and the keychain cannot open it
 * right now — locked, unavailable, reset, or a different OS user. Not corrupt,
 * and NEVER a reason to regenerate: unlocking the keychain fixes it.
 */
export class KeyfileLocked extends Error {
  constructor(path: string, reason: string) {
    super(
      `The secrets key in ${path} is protected by your operating system's keychain, which could not open it (${reason}). ` +
        "Unlock the keychain (on Linux, start GNOME Keyring or KWallet) and restart APIWeave. Do not delete the file — every stored secret depends on it.",
    )
    this.name = "KeyfileLocked"
  }
}

export interface Keyfile {
  readonly masterKek: Uint8Array
}

type KeyfileJson =
  | { readonly version: typeof PLAIN_VERSION; readonly masterKekBase64: string }
  | { readonly version: typeof SEALED_VERSION; readonly sealedKekBase64: string }

/** True if a keyfile exists at `path` (says nothing about validity). */
export function keyfileExists(path: string): boolean {
  return existsSync(path)
}

/**
 * Read and validate the keyfile. Throws {@link KeyfileMissing} if absent,
 * {@link KeyfileCorrupted} if present but unparseable / wrong-shape / wrong key
 * length, and {@link KeyfileLocked} if sealed and `protector` cannot open it.
 *
 * A plaintext keyfile read with a protector available is sealed in place —
 * the same KEK, now protected — so a keyfile written before the keychain was
 * used, or before one was available, does not stay exposed.
 */
export function readKeyfile(path: string, protector: KeyProtector | null): Keyfile {
  if (!existsSync(path)) {
    throw new KeyfileMissing(path)
  }

  let raw: string
  try {
    raw = readFileSync(path, "utf-8")
  } catch (err) {
    throw new KeyfileCorrupted(path, `unreadable: ${(err as Error).message}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new KeyfileCorrupted(path, `invalid JSON: ${(err as Error).message}`)
  }

  const obj = parsed as Partial<{ version: number; masterKekBase64: unknown; sealedKekBase64: unknown }>
  let masterKek: Buffer
  if (obj.version === PLAIN_VERSION) {
    if (typeof obj.masterKekBase64 !== "string") {
      throw new KeyfileCorrupted(path, "missing masterKekBase64")
    }
    masterKek = Buffer.from(obj.masterKekBase64, "base64")
  } else if (obj.version === SEALED_VERSION) {
    if (typeof obj.sealedKekBase64 !== "string") {
      throw new KeyfileCorrupted(path, "missing sealedKekBase64")
    }
    if (protector === null) {
      throw new KeyfileLocked(path, "the keychain is unavailable")
    }
    try {
      masterKek = protector.decrypt(Buffer.from(obj.sealedKekBase64, "base64"))
    } catch (err) {
      throw new KeyfileLocked(path, (err as Error).message)
    }
  } else {
    throw new KeyfileCorrupted(path, `unexpected version ${String(obj.version)}`)
  }
  if (masterKek.length !== DEK_SIZE) {
    throw new KeyfileCorrupted(path, `master KEK must be ${DEK_SIZE} bytes, got ${masterKek.length}`)
  }
  if (obj.version === PLAIN_VERSION && protector !== null) {
    writeKeyfileAtomically(path, serialize(masterKek, protector))
  }
  return { masterKek }
}

/**
 * Open the keyfile, creating one only on a genuine first run.
 *
 * A missing keyfile while the database holds sealed secrets is not a first run:
 * it is a database restored or copied without the keyfile beside it. A fresh
 * KEK there would orphan every one of those secrets without a word, so this
 * throws {@link KeyfileMissing} and leaves the decision to the user.
 */
export function openKeyfile(path: string, protector: KeyProtector | null, sealedSecretCount: number): Keyfile {
  if (existsSync(path)) return readKeyfile(path, protector)
  if (sealedSecretCount > 0) {
    throw new KeyfileMissing(
      path,
      `The database holds ${sealedSecretCount} encrypted secret(s) that only that keyfile can open — it was probably left behind when the database was restored or copied. ` +
        "Copy keyfile.json from the same backup or installation into the data folder and restart APIWeave.",
    )
  }
  return createKeyfile(path, protector)
}

/**
 * Bootstrap a new keyfile with a fresh random master KEK, sealed by `protector`
 * when there is one. Refuses to overwrite an existing file (throws
 * {@link KeyfileCorrupted} rather than clobbering an unrecognised one) — the
 * only path that ever creates a KEK.
 */
export function createKeyfile(path: string, protector: KeyProtector | null): Keyfile {
  if (existsSync(path)) {
    throw new KeyfileCorrupted(path, "already exists — refusing to overwrite and orphan stored secrets")
  }
  const masterKek = randomBytes(DEK_SIZE)
  writeFileSync(path, serialize(masterKek, protector), { encoding: "utf-8", mode: 0o600, flag: "wx" })
  return { masterKek }
}

function serialize(masterKek: Buffer, protector: KeyProtector | null): string {
  const json: KeyfileJson = protector === null
    ? { version: PLAIN_VERSION, masterKekBase64: masterKek.toString("base64") }
    : { version: SEALED_VERSION, sealedKekBase64: protector.encrypt(masterKek).toString("base64") }
  return JSON.stringify(json)
}

/**
 * Replace the keyfile without a window in which it is half-written: a crash
 * mid-write must leave the old, still-valid file, never a truncated one that
 * reads as corrupt.
 */
function writeKeyfileAtomically(path: string, contents: string): void {
  const temporary = `${path}.tmp`
  writeFileSync(temporary, contents, { encoding: "utf-8", mode: 0o600 })
  renameSync(temporary, path)
}
