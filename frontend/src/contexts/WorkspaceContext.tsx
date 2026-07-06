import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Organization } from "../types/Organization";
import type { Workspace } from "../types/Workspace";
import type {
  WorkspaceContextValue,
  WorkspaceEntry,
} from "../types/WorkspaceContextValue";
import { authenticatedJson } from "../utils/apiweaveClient";
import API_BASE_URL from "../utils/apiweaveClient";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface WorkspaceProviderProps {
  children: ReactNode;
}

export function WorkspaceProvider({ children }: WorkspaceProviderProps) {
  const navigate = useNavigate();
  const params = useParams<{ orgSlug?: string; workspaceSlug?: string }>();

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [memberships, setMemberships] = useState<Map<string, string>>(
    new Map(),
  );
  const [isLoading, setIsLoading] = useState(true);

  const loadWorkspaceData = useCallback(async () => {
    const [orgsRes, workspacesRes] = await Promise.all([
      authenticatedJson<Organization[]>(`${API_BASE_URL}/api/orgs`),
      authenticatedJson<{ workspaces: Workspace[]; total: number }>(
        `${API_BASE_URL}/api/workspaces`,
      ),
    ]);

    const roleMap = new Map<string, string>();
    for (const ws of workspacesRes.workspaces) {
      roleMap.set(ws.workspaceId, ws.ownerType === "user" ? "owner" : "write");
    }

    return { orgs: orgsRes, workspaces: workspacesRes.workspaces, roleMap };
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await loadWorkspaceData();
      setOrgs(data.orgs);
      setWorkspaces(data.workspaces);
      setMemberships(data.roleMap);
    } catch {
      setOrgs([]);
      setWorkspaces([]);
      setMemberships(new Map());
    } finally {
      setIsLoading(false);
    }
  }, [loadWorkspaceData]);

  // Fetch orgs + workspaces on mount
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      try {
        const data = await loadWorkspaceData();

        if (cancelled) return;

        setOrgs(data.orgs);
        setWorkspaces(data.workspaces);
        setMemberships(data.roleMap);
      } catch {
        // Silently handle — user may not have orgs/workspaces yet
        if (!cancelled) {
          setOrgs([]);
          setWorkspaces([]);
          setMemberships(new Map());
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadWorkspaceData]);

  // Build available workspaces list (personal + org workspaces)
  const availableWorkspaces = useMemo<WorkspaceEntry[]>(() => {
    const orgMap = new Map(orgs.map((o) => [o.orgId, o]));
    return workspaces.map((ws) => ({
      org: ws.orgId ? (orgMap.get(ws.orgId) ?? null) : null,
      workspace: ws,
      role: memberships.get(ws.workspaceId) ?? "read",
    }));
  }, [orgs, workspaces, memberships]);

  // Determine current org + workspace from URL params
  const currentOrg = useMemo<Organization | null>(() => {
    if (!params.orgSlug || params.orgSlug === "personal") return null;
    return orgs.find((o) => o.slug === params.orgSlug) ?? null;
  }, [orgs, params.orgSlug]);

  const currentWorkspace = useMemo<Workspace | null>(() => {
    if (!params.workspaceSlug) {
      // Fall back to personal workspace
      return workspaces.find((ws) => ws.isPersonal) ?? null;
    }
    if (currentOrg) {
      return (
        workspaces.find(
          (ws) =>
            ws.slug === params.workspaceSlug && ws.orgId === currentOrg.orgId,
        ) ?? null
      );
    }
    // Personal workspace
    return (
      workspaces.find(
        (ws) => ws.slug === params.workspaceSlug && ws.isPersonal,
      ) ?? null
    );
  }, [workspaces, currentOrg, params.workspaceSlug]);

  const currentRole = useMemo<string | null>(() => {
    if (!currentWorkspace) return null;
    return memberships.get(currentWorkspace.workspaceId) ?? null;
  }, [currentWorkspace, memberships]);

  const switchTo = useCallback(
    (orgSlug: string, workspaceSlug: string) => {
      navigate(`/${orgSlug}/${workspaceSlug}/workflows`, { replace: false });
    },
    [navigate],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      orgs,
      availableWorkspaces,
      currentOrg,
      currentWorkspace,
      currentRole,
      switchTo,
      refresh,
      isLoading,
    }),
    [
      orgs,
      availableWorkspaces,
      currentOrg,
      currentWorkspace,
      currentRole,
      switchTo,
      refresh,
      isLoading,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return ctx;
}

export default WorkspaceContext;
