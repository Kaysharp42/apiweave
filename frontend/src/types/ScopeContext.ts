/**
 * ScopeContext — return type of useScopeContext().
 *
 * Exposes the resolved current-scope identifiers consumed by scoped API helpers
 * and components.  Returns `isReady: false` while WorkspaceContext is loading;
 * callers should not fire scoped requests until isReady is true.
 */
export interface ScopeContext {
  /** Resolved current workspace ID, or null when not loaded. */
  workspaceId: string | null;
  /** Resolved current workspace slug, or null when not loaded. */
  workspaceSlug: string | null;
  /** Current organization ID, or null when on personal workspace. */
  orgId: string | null;
  /** Current organization slug, or null when on personal workspace or not loaded. */
  orgSlug: string | null;
  /** Authenticated user ID, or null when not logged in. */
  userId: string | null;
  /** True when WorkspaceContext has finished loading and scope is resolvable. */
  isReady: boolean;
}
