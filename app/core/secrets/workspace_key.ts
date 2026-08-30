/**
 * Workspace end-to-end encryption keys — the client half of E2EE cloud sync.
 *
 * Key hierarchy: a user passphrase is stretched by scrypt into a workspace KEK,
 * which wraps a random 32-byte Workspace Data Encryption Key (WDEK). Every
 * synced record's JSON is sealed under the WDEK into a JSON *envelope* (the
 * server column is `JSONB NOT NULL`, so the ciphertext has to be an object, not
 * a blob). The server only ever sees the envelope and the wrapped WDEK.
 *
 * INVARIANT: no Electron, no filesystem, no repository in this file. It is pure
 * `node:crypto` so it can be unit-tested in plain Node — key *storage* lives in
 * the main process (`electron/cloud/wdek-cache.ts`), key *math* lives here.
 *
 * KDF parameters are carried alongside the data (envelope/settings), never
 * hardcoded at the read site: raising the work factor later must not strand
 * workspaces derived under the old one, so {@link deriveKek} takes them in.
 */

import { createHash, scryptSync } from "node:crypto"
import { ALGORITHM, DEK_SIZE, decrypt, encrypt, type EncryptedBlob } from "./crypto"

export { unwrapDek as unwrapWdek, wrapDek as wrapWdek } from "./crypto"

/** scrypt cost parameters, stored per workspace so old data stays derivable. */
export interface KdfParams {
  readonly N: number
  readonly r: number
  readonly p: number
}

/** Current work factor for new workspaces. N = 2^17. */
export const DEFAULT_KDF_PARAMS: KdfParams = { N: 131072, r: 8, p: 1 }

/**
 * scrypt's own memory guard defaults to 32 MiB, which is *below* what N=2^17,
 * r=8 needs (128 * N * r ≈ 128 MiB) — without this Node throws before hashing.
 */
const SCRYPT_MAXMEM = 256 * 1024 * 1024

/** The record is sealed with a different key than the one we hold. */
export class WorkspaceKeyMismatch extends Error {
  constructor(expected: string, actual: string) {
    super(
      `Record is encrypted with workspace key ${expected}, but the key held for this workspace is ${actual}. ` +
        "The passphrase for that key is needed to read it.",
    )
    this.name = "WorkspaceKeyMismatch"
  }
}

/** The GCM tag did not verify: the envelope or its bound identity was altered. */
export class EnvelopeAuthFailed extends Error {
  constructor(reason: string) {
    super(`Encrypted record failed authentication (${reason}) — it was modified in transit or does not belong here.`)
    this.name = "EnvelopeAuthFailed"
  }
}

/** Stretch `passphrase` into a 32-byte workspace KEK. ~200 ms at the defaults. */
export function deriveKek(passphrase: string, salt: Uint8Array, params: KdfParams): Uint8Array {
  return scryptSync(passphrase, Buffer.from(salt), DEK_SIZE, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: SCRYPT_MAXMEM,
  })
}

/** First 8 bytes of SHA-256(wdek), lowercase hex — identifies a key without revealing it. */
export function fingerprint(wdek: Uint8Array): string {
  return createHash("sha256").update(Buffer.from(wdek)).digest("hex").slice(0, 16)
}

/**
 * The additional-authenticated-data string bound into every envelope. Not stored
 * — the reader recomputes it, so a ciphertext moved to another record or another
 * cloud workspace fails its tag check. One helper so seal and open cannot
 * disagree on the format.
 */
export function envelopeAad(cloudWorkspaceId: string, kind: string, recordId: string): string {
  return `${cloudWorkspaceId}|${kind}|${recordId}`
}

interface EnvelopeJson {
  e2ee: 1
  kid: string
  n: string
  ct: string
}

/** Seal a record's JSON under `wdek`, bound to `aad` (build it with {@link envelopeAad}). */
export function sealEnvelope(plaintextJson: string, wdek: Uint8Array, aad: string): string {
  const blob = encrypt(plaintextJson, wdek, fingerprint(wdek), undefined, Buffer.from(aad, "utf-8"))
  const envelope: EnvelopeJson = {
    e2ee: 1,
    kid: blob.kekId,
    n: Buffer.from(blob.nonce).toString("base64"),
    ct: Buffer.from(blob.ciphertext).toString("base64"),
  }
  return JSON.stringify(envelope)
}

/**
 * Open an envelope produced by {@link sealEnvelope}.
 *
 * Throws {@link WorkspaceKeyMismatch} when the envelope names a key we do not
 * hold (recoverable: ask for that passphrase) and {@link EnvelopeAuthFailed}
 * when the bytes or the bound identity were tampered with (not recoverable).
 */
export function openEnvelope(envelopeJson: string, wdek: Uint8Array, aad: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(envelopeJson)
  } catch (err) {
    throw new EnvelopeAuthFailed(`invalid JSON: ${(err as Error).message}`)
  }
  const env = parsed as Partial<EnvelopeJson>
  if (env?.e2ee !== 1 || typeof env.kid !== "string" || typeof env.n !== "string" || typeof env.ct !== "string") {
    throw new EnvelopeAuthFailed("not an e2ee envelope")
  }

  const held = fingerprint(wdek)
  if (env.kid !== held) {
    throw new WorkspaceKeyMismatch(env.kid, held)
  }

  const blob: EncryptedBlob = {
    ciphertext: Buffer.from(env.ct, "base64"),
    nonce: Buffer.from(env.n, "base64"),
    kekId: env.kid,
    algorithm: ALGORITHM,
  }
  try {
    return decrypt(blob, wdek, Buffer.from(aad, "utf-8"))
  } catch (err) {
    throw new EnvelopeAuthFailed((err as Error).message)
  }
}
