import type { SecretScopeType } from "./SecretScopeType";

/** Metadata for one stored secret, as the `secrets.*` IPC handlers return it. Carries no secret material. */
export interface SecretMetadata {
  readonly secretId: string;
  readonly name: string;
  readonly scopeType: SecretScopeType;
  readonly scopeId: string;
  readonly keyId: string;
  readonly label?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
