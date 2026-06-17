/**
 * User-secret binding — binds a user-scoped secret to a workspace or environment.
 */
export interface SecretBinding {
  bindingId: string;
  secretId: string;
  userId: string;
  targetScopeType: 'workspace' | 'environment';
  targetScopeId: string;
  createdAt: string;
}
