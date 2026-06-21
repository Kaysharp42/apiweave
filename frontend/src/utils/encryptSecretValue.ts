/**
 * Lazy-load libsodium-wrappers and encrypt a plaintext secret value
 * using a sealed box (anonymous sender, Curve25519-XSalsa20-Poly1305).
 *
 * The plaintext value is held in ephemeral scope only — never persisted,
 * logged, or included in URLs.
 */

import type { SecretPublicKey } from '../types';

type Sodium = typeof import('libsodium-wrappers') & {
  default: typeof import('libsodium-wrappers');
};

let sodiumPromise: Promise<Sodium> | null = null;

function loadSodium(): Promise<Sodium> {
  if (!sodiumPromise) {
    sodiumPromise = import('libsodium-wrappers').then(async (mod) => {
      await mod.ready;
      const sodium = mod.default ?? mod;
      return sodium as Sodium;
    });
  }
  return sodiumPromise;
}

export async function encryptSecretValue(
  plaintext: string,
  publicKeyInfo: SecretPublicKey,
): Promise<string> {
  const sodium = await loadSodium();

  const publicKeyBytes = sodium.from_base64(
    publicKeyInfo.publicKey,
    sodium.base64_variants.ORIGINAL,
  );
  const plaintextBytes = sodium.from_string(plaintext);

  const encrypted = sodium.crypto_box_seal(plaintextBytes, publicKeyBytes);

  plaintextBytes.fill(0);

  return sodium.to_base64(encrypted);
}
