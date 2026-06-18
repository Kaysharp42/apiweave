import { useMemo } from 'react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useAuth } from '../auth/useAuth';
import type { ScopeContext } from '../types';

/**
 * useScopeContext — derive current scope identifiers from the existing
 * WorkspaceContext (org/workspace) and AuthContext (user).
 *
 * Returns `{ isReady: false }` while WorkspaceContext is still loading,
 * so callers can gate scoped API requests behind `isReady`.
 */
export function useScopeContext(): ScopeContext {
  const { currentWorkspace, currentOrg, isLoading: workspaceLoading } = useWorkspace();
  const { user } = useAuth();

  return useMemo<ScopeContext>(() => {
    if (workspaceLoading || !currentWorkspace) {
      return {
        workspaceId: null,
        workspaceSlug: null,
        orgId: null,
        orgSlug: null,
        userId: user?.userId ?? null,
        isReady: false,
      };
    }

    return {
      workspaceId: currentWorkspace.workspaceId,
      workspaceSlug: currentWorkspace.slug,
      orgId: currentOrg?.orgId ?? null,
      orgSlug: currentOrg?.slug ?? null,
      userId: user?.userId ?? null,
      isReady: true,
    };
  }, [currentWorkspace, currentOrg, workspaceLoading, user?.userId]);
}
