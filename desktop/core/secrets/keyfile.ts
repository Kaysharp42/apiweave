/**
 * Local keyfile — the root of the desktop secrets subsystem.
 *
 * Holds the master Key Encryption Key (KEK) that unwraps every per-scope DEK.
 * Stored as JSON under Electron's `userData` (path injected, so tests point at a
 * temp dir). Per-scope keypairs live in the `scoped_keys` table, their private
 * keys wrapped by this KEK — lose the keyfile and every stored secret is orphaned.
 *
 * INVARIANT (ported from the strategy doc, Key Decision #4): NEVER regenerate the
 * KEK on a corrupt or unreadable keyfile. A missing keyfile is first-run and only
 * an explicit {@link createKeyfile} may write one; a present-but-broken keyfile
 * throws {@link KeyfileCorrupted} loudly. Silent regeneration would swap the KEK
 * and orphan every secret the user already stored — data loss disguised as recovery.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { DEK_SIZE } from "./crypto"

const KEYFILE_VERSION = 1

/** Present-but-broken keyfile. NEVER auto-recovered — throwing preserves stored secrets. */
export class KeyfileCorrupted extends Error {
  constructor(path: string, reason: string) {
    super(`Keyfile at ${path} is corrupt (${reason}). Refusing to regenerate — that would orphan every stored secret.`)
    this.name = "KeyfileCorrupted"
  }
}

/** No keyfile present. First-run: call {@link createKeyfile} explicitly to bootstrap. */
export class KeyfileMissing extends Error {
  constructor(path: string) {
    super(`No keyfile at ${path}. Call createKeyfile() to bootstrap first-run.`)
    this.name = "KeyfileMissing"
  }
}

export interface Keyfile {
  readonly masterKek: Uint8Array
}

interface KeyfileJson {
  version: number
  masterKekBase64: string
}

/** True if a keyfile exists at `path` (says nothing about validity). */
export function keyfileExists(path: string): boolean {
  return existsSync(path)
}

/**
 * Read and validate the keyfile. Throws {@link KeyfileMissing} if absent and
 * {@link KeyfileCorrupted} if present but unparseable / wrong-shape / wrong key
 * length. Never writes.
 */
export function readKeyfile(path: string): Keyfile {
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

  const obj = parsed as Partial<KeyfileJson>
  if (obj.version !== KEYFILE_VERSION) {
    throw new KeyfileCorrupted(path, `unexpected version ${String(obj.version)}`)
  }
  if (typeof obj.masterKekBase64 !== "string") {
    throw new KeyfileCorrupted(path, "missing masterKekBase64")
  }
  const masterKek = Buffer.from(obj.masterKekBase64, "base64")
  if (masterKek.length !== DEK_SIZE) {
    throw new KeyfileCorrupted(path, `master KEK must be ${DEK_SIZE} bytes, got ${masterKek.length}`)
  }
  return { masterKek }
}

/**
 * Bootstrap a new keyfile with a fresh random master KEK. Refuses to overwrite an
 * existing file (throws {@link KeyfileCorrupted} rather than clobbering an
 * unrecognised one) — the only path that ever writes a KEK.
 */
export function createKeyfile(path: string): Keyfile {
  if (existsSync(path)) {
    throw new KeyfileCorrupted(path, "already exists — refusing to overwrite and orphan stored secrets")
  }
  const masterKek = randomBytes(DEK_SIZE)
  const json: KeyfileJson = {
    version: KEYFILE_VERSION,
    masterKekBase64: Buffer.from(masterKek).toString("base64"),
  }
  writeFileSync(path, JSON.stringify(json), { encoding: "utf-8", mode: 0o600 })
  return { masterKek }
}
