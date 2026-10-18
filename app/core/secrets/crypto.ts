/**
 * AES-256-GCM encryption — ported from `backend/app/services/secret_crypto.py`.
 *
 * The wire format is byte-identical to the Python `cryptography` AESGCM output
 * — `ciphertext || tag(16)` — so the fixtures captured from Python round-trip
 * exactly.
 *
 * Node's `crypto` returns the GCM tag separately; we append it (Python style).
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

export const NONCE_SIZE = 12 // AES-GCM standard nonce
export const TAG_SIZE = 16 // AES-GCM authentication tag
export const DEK_SIZE = 32 // 256-bit DEK
export const ALGORITHM = "aes-256-gcm"

/** An encrypted secret payload. `ciphertext` is `body || tag`, matching Python. */
export interface EncryptedBlob {
  readonly ciphertext: Uint8Array
  readonly nonce: Uint8Array
  readonly kekId: string
  readonly algorithm: typeof ALGORITHM
}

function assertKey(key: Uint8Array, name: string): void {
  if (key.length !== 32) {
    throw new Error(`${name} must be 32 bytes, got ${key.length}`)
  }
}

/**
 * Encrypt `plaintext` (UTF-8) under `dek`. If `nonce` is omitted a random 12-byte
 * nonce is generated; pass a fixed nonce only to reproduce a known vector.
 *
 * `aad` is authenticated but not encrypted: the same bytes must be supplied to
 * {@link decrypt} or the tag check fails. Used to bind a ciphertext to its
 * record identity so it cannot be replayed onto a different row.
 */
export function encrypt(
  plaintext: string,
  dek: Uint8Array,
  kekId: string,
  nonce: Uint8Array = randomBytes(NONCE_SIZE),
  aad?: Uint8Array,
): EncryptedBlob {
  assertKey(dek, "dek")
  const cipher = createCipheriv(ALGORITHM, dek, nonce)
  if (aad !== undefined) {
    cipher.setAAD(Buffer.from(aad))
  }
  const body = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf-8")), cipher.final()])
  const ciphertext = Buffer.concat([body, cipher.getAuthTag()])
  return { ciphertext, nonce, kekId, algorithm: ALGORITHM }
}

/**
 * Decrypt an {@link EncryptedBlob} under `dek`, returning the decoded UTF-8 value.
 * `aad` must be byte-identical to what {@link encrypt} was given, or the GCM tag
 * check fails.
 */
export function decrypt(blob: EncryptedBlob, dek: Uint8Array, aad?: Uint8Array): string {
  assertKey(dek, "dek")
  return decryptRaw(dek, blob.nonce, blob.ciphertext, aad).toString("utf-8")
}

function decryptRaw(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad?: Uint8Array,
): Buffer {
  if (ciphertext.length < TAG_SIZE) {
    throw new Error("ciphertext is too short to contain a GCM tag")
  }
  const body = ciphertext.subarray(0, ciphertext.length - TAG_SIZE)
  const tag = ciphertext.subarray(ciphertext.length - TAG_SIZE)
  const decipher = createDecipheriv(ALGORITHM, key, nonce)
  if (aad !== undefined) {
    decipher.setAAD(Buffer.from(aad))
  }
  decipher.setAuthTag(Buffer.from(tag))
  return Buffer.concat([decipher.update(Buffer.from(body)), decipher.final()])
}
