import type { SecretScopeType } from './Secret';

/**
 * Payload for writing a client-encrypted secret value.
 *
 * The `ciphertext` field is the ONLY secret material sent over the wire —
 * plaintext is never transmitted.
 */
export interface EncryptedSecretValue {
  scopeType: SecretScopeType;
  scopeId: string;
  name: string;
  ciphertext: string;
  keyId: string;
}
