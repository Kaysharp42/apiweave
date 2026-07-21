/**
 * AES-256-GCM envelope encryption — ported from `backend/app/services/secret_crypto.py`
 * and `secret_kek.py`.
 *
 * Envelope model: each secret is encrypted with a per-scope Data Encryption Key
 * (DEK); the DEK is itself wrapped by the master Key Encryption Key (KEK). The
 * wire format is byte-identical to the Python `cryptography` AESGCM output —
 * `ciphertext || tag(16)` for the payload, `nonce(12) || ciphertext || tag(16)`
 * for a wrapped DEK — so the fixtures captured from Python round-trip exactly.
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
 */
export function encrypt(
  plaintext: string,
  dek: Uint8Array,
  kekId: string,
  nonce: Uint8Array = randomBytes(NONCE_SIZE),
): EncryptedBlob {
  assertKey(dek, "dek")
  const cipher = createCipheriv(ALGORITHM, dek, nonce)
  const body = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf-8")), cipher.final()])
  const ciphertext = Buffer.concat([body, cipher.getAuthTag()])
  return { ciphertext, nonce, kekId, algorithm: ALGORITHM }
}

/** Decrypt an {@link EncryptedBlob} under `dek`, returning the decoded UTF-8 value. */
export function decrypt(blob: EncryptedBlob, dek: Uint8Array): string {
  assertKey(dek, "dek")
  return decryptRaw(dek, blob.nonce, blob.ciphertext).toString("utf-8")
}

/**
 * Wrap a DEK with the master KEK. Returns `nonce(12) || ciphertext || tag(16)`
 * as raw bytes (base64-encode before storage). Matches `secret_kek.wrap_dek`.
 */
export function wrapDek(
  dek: Uint8Array,
  masterKey: Uint8Array,
  nonce: Uint8Array = randomBytes(NONCE_SIZE),
): Uint8Array {
  assertKey(masterKey, "masterKey")
  const cipher = createCipheriv(ALGORITHM, masterKey, nonce)
  const body = Buffer.concat([cipher.update(Buffer.from(dek)), cipher.final()])
  return Buffer.concat([Buffer.from(nonce), body, cipher.getAuthTag()])
}

/** Unwrap a DEK previously wrapped by {@link wrapDek}. Matches `secret_kek.unwrap_dek`. */
export function unwrapDek(wrapped: Uint8Array, masterKey: Uint8Array): Uint8Array {
  assertKey(masterKey, "masterKey")
  if (wrapped.length < NONCE_SIZE + TAG_SIZE) {
    throw new Error("wrapped DEK is too short to contain nonce + tag")
  }
  const nonce = wrapped.subarray(0, NONCE_SIZE)
  const ciphertext = wrapped.subarray(NONCE_SIZE)
  return decryptRaw(masterKey, nonce, ciphertext)
}

/** Generate a fresh 256-bit DEK. */
export function generateDek(): Uint8Array {
  return randomBytes(DEK_SIZE)
}

function decryptRaw(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): Buffer {
  if (ciphertext.length < TAG_SIZE) {
    throw new Error("ciphertext is too short to contain a GCM tag")
  }
  const body = ciphertext.subarray(0, ciphertext.length - TAG_SIZE)
  const tag = ciphertext.subarray(ciphertext.length - TAG_SIZE)
  const decipher = createDecipheriv(ALGORITHM, key, nonce)
  decipher.setAuthTag(Buffer.from(tag))
  return Buffer.concat([decipher.update(Buffer.from(body)), decipher.final()])
}
