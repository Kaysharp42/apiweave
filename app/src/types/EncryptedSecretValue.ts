import type { SecretScopeType } from "./Secret";

/**
 * Payload for writing a client-encrypted secret value.
 *
 * The `sealed` bytes are the ONLY secret material sent to the main process —
 * plaintext is never transmitted.
 */
export interface EncryptedSecretValue {
  scopeType: SecretScopeType;
  scopeId: string;
  workspaceId?: string;
  name: string;
  sealed: Uint8Array;
  keyId: string;
}
