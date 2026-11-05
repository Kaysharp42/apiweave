import { useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import { useWorkspace } from "../contexts/WorkspaceContext";

/**
 * Opens this workspace's tutorial list, falling back to the slugs on the route
 * and then to the personal workspace while the scope is still loading.
 */
export function useOpenTutorials(): () => void {
  const { currentOrg, currentWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const routeParams = useParams<{
    orgSlug?: string;
    workspaceSlug?: string;
  }>();

  return useCallback(() => {
    const org = currentOrg?.slug ?? routeParams.orgSlug ?? "personal";
    const ws =
      currentWorkspace?.slug ?? routeParams.workspaceSlug ?? "personal";
    navigate(`/${org}/${ws}/tutorials`);
  }, [
    navigate,
    currentOrg?.slug,
    currentWorkspace?.slug,
    routeParams.orgSlug,
    routeParams.workspaceSlug,
  ]);
}
