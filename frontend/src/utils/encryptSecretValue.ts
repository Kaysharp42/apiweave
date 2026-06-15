/**
 * Lazy-load libsodium-wrappers and encrypt a plaintext secret value
 * using a sealed box (anonymous sender, Curve25519-XSalsa20-Poly1305).
 *
 * The plaintext value is held in ephemeral scope only — never persisted,
 * logged, or included in URLs.
 */

import type { SecretPublicKey } from '../types';

let sodiumPromise: Promise<typeof import('libsodium-wrappers')> | null = null;

function loadSodium(): Promise<typeof import('libsodium-wrappers')> {
  if (!sodiumPromise) {
    sodiumPromise = import('libsodium-wrappers').then(async (mod) => {
      await mod.ready;
      return mod;
    });
  }
  return sodiumPromise;
}

/**
 * Encrypt a plaintext value with the backend's public key using a
 * libsodium sealed box. Returns the base64-encoded ciphertext.
 *
 * @param plaintext - The secret value to encrypt (ephemeral — not stored).
 * @param publicKeyInfo - The backend's public key + keyId from the API.
 * @returns Base64-encoded sealed-box ciphertext.
 */
export async function encryptSecretValue(
  plaintext: string,
  publicKeyInfo: SecretPublicKey,
): Promise<string> {
  const sodium = await loadSodium();

  const publicKeyBytes = sodium.from_base64(publicKeyInfo.publicKey);
  const plaintextBytes = sodium.from_string(plaintext);

  const encrypted = sodium.crypto_box_seal(plaintextBytes, publicKeyBytes);

  // Zero out plaintext bytes from memory ASAP
  plaintextBytes.fill(0);

  return sodium.to_base64(encrypted);
}
