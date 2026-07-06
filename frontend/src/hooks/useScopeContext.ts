import { useMemo } from "react";
import { useWorkspace } from "../contexts/WorkspaceContext";
import { useAuth } from "../auth/useAuth";
import type { ScopeContext } from "../types";

/**
 * useScopeContext — derive current scope identifiers from the existing
 * WorkspaceContext (workspace) and AuthContext (user).
 *
 * Returns `{ isReady: false }` while WorkspaceContext is still loading,
 * so callers can gate scoped API requests behind `isReady`.
 */
export function useScopeContext(): ScopeContext {
  const {
    currentWorkspace,
    isLoading: workspaceLoading,
  } = useWorkspace();
  const { user } = useAuth();

  return useMemo<ScopeContext>(() => {
    if (workspaceLoading || !currentWorkspace) {
      return {
        workspaceId: null,
        workspaceSlug: null,
        orgId: null as null,
        orgSlug: null as null,
        userId: user?.userId ?? null,
        isReady: false,
      };
    }

    return {
      workspaceId: currentWorkspace.workspaceId,
      workspaceSlug: currentWorkspace.slug,
      orgId: null as null,
      orgSlug: null as null,
      userId: user?.userId ?? null,
      isReady: true,
    };
  }, [currentWorkspace, workspaceLoading, user?.userId]);
}
