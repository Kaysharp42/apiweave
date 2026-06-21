/**
 * Scoped secret metadata — returned by list/get endpoints.
 *
 * NEVER includes ciphertext or plaintext value.
 */
export interface Secret {
  secretId: string;
  name: string;
  scopeType: SecretScopeType;
  scopeId: string;
  keyId: string;
  createdAt: string;
  updatedAt: string;
}

/** Valid scope types for scoped secrets. */
export type SecretScopeType =
  | "user"
  | "organization"
  | "workspace"
  | "environment";
