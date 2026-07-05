/**
 * libsodium sealed-box ingress — ported from `backend/app/services/secret_sealed_box.py`
 * and `scoped_secret_resolver.py`.
 *
 * Write-only transport: the renderer encrypts a secret value with the scope's
 * Curve25519 public key via `crypto_box_seal` (anonymous sender); the trusted
 * main process opens it with the private key, then re-encrypts at rest with the
 * AES-256-GCM envelope (`crypto.ts`). There is NO read-back — the opened
 * plaintext is used only transiently by the runtime during substitution.
 *
 * A private key is a raw 32-byte Curve25519 seed (PyNaCl `PrivateKey(seed)`);
 * the public key is `crypto_scalarmult_base(seed)`. This matches the byte-for-byte
 * wire format PyNaCl produces, so the captured crypto fixtures interop exactly.
 */

import _sodium from "libsodium-wrappers"

export const SEED_SIZE = 32
export const ALGORITHM = "libsodium-sealed-box"

let readyPromise: Promise<typeof _sodium> | null = null

/** Resolve the initialised libsodium instance (idempotent). */
export async function sodiumReady(): Promise<typeof _sodium> {
  if (readyPromise === null) {
    readyPromise = _sodium.ready.then(() => _sodium)
  }
  return readyPromise
}

function assertSeed(seed: Uint8Array): void {
  if (seed.length !== SEED_SIZE) {
    throw new Error(`sealed-box seed must be ${SEED_SIZE} bytes, got ${seed.length}`)
  }
}

/** Derive the Curve25519 public key for a private-key seed. */
export async function publicKeyFromSeed(seed: Uint8Array): Promise<Uint8Array> {
  assertSeed(seed)
  const sodium = await sodiumReady()
  return sodium.crypto_scalarmult_base(seed)
}

/** Seal a `value` (UTF-8) for a recipient public key. Non-deterministic. */
export async function seal(value: string, publicKey: Uint8Array): Promise<Uint8Array> {
  const sodium = await sodiumReady()
  const bytes = sodium.from_string(value)
  try {
    return sodium.crypto_box_seal(bytes, publicKey)
  } finally {
    bytes.fill(0)
  }
}

/**
 * Open a sealed-box ciphertext with the scope's private-key seed, returning the
 * UTF-8 plaintext. This is the ONLY path that yields a secret's plaintext, and
 * only the trusted runtime calls it. Throws if the ciphertext is invalid or was
 * sealed for a different key.
 */
export async function openSealedBox(ciphertext: Uint8Array, seed: Uint8Array): Promise<string> {
  assertSeed(seed)
  const sodium = await sodiumReady()
  const publicKey = sodium.crypto_scalarmult_base(seed)
  const opened = sodium.crypto_box_seal_open(ciphertext, publicKey, seed)
  return sodium.to_string(opened)
}
