/**
 * One-time service token creation response.
 *
 * The `token` field is shown ONLY at creation/rotation time.
 * Subsequent metadata calls NEVER return the token value.
 */
export interface ServiceTokenCreateResponse {
  tokenId: string;
  name: string;
  token: string;
  scopeType: "workspace" | "organization";
  scopeId: string;
  permissions: string[];
  createdAt: string;
  expiresAt?: string;
}
