/**
 * ScopeContext — return type of useScopeContext().
 *
 * Exposes the resolved current-scope identifiers consumed by scoped API helpers
 * and components.  Returns `isReady: false` while WorkspaceContext is loading;
 * callers should not fire scoped requests until isReady is true.
 */
export interface ScopeContext {
  workspaceId: string | null;
  workspaceSlug: string | null;
  orgId: null;
  orgSlug: null;
  userId: string | null;
  isReady: boolean;
}
