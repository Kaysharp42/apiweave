/**
 * Service token metadata — returned by list/get endpoints.
 *
 * NEVER includes the raw token value or hash.
 */
export interface ServiceToken {
  tokenId: string;
  name: string;
  description?: string;
  scopeType: 'workspace' | 'organization';
  scopeId: string;
  permissions: string[];
  createdBy: string;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
}
