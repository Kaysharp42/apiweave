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
import type { Workspace } from "../types/Workspace";
import type {
  WorkspaceContextValue,
  WorkspaceEntry,
} from "../types/WorkspaceContextValue";
import { authenticatedJson } from "../utils/apiweaveClient";
import API_BASE_URL from "../utils/apiweaveClient";

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

interface WorkspaceProviderProps {
  children: ReactNode;
}

export function WorkspaceProvider({ children }: WorkspaceProviderProps) {
  const navigate = useNavigate();
  const params = useParams<{ workspaceSlug?: string }>();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [memberships, setMemberships] = useState<Map<string, string>>(
    new Map(),
  );
  const [isLoading, setIsLoading] = useState(true);

  const loadWorkspaceData = useCallback(async () => {
    const workspacesRes = await authenticatedJson<{ workspaces: Workspace[]; total: number }>(
      `${API_BASE_URL}/api/workspaces`,
    );

    const roleMap = new Map<string, string>();
    for (const ws of workspacesRes.workspaces) {
      roleMap.set(ws.workspaceId, ws.ownerType === "user" ? "owner" : "write");
    }

    return { workspaces: workspacesRes.workspaces, roleMap };
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await loadWorkspaceData();
      setWorkspaces(data.workspaces);
      setMemberships(data.roleMap);
    } catch {
      setWorkspaces([]);
      setMemberships(new Map());
    } finally {
      setIsLoading(false);
    }
  }, [loadWorkspaceData]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      try {
        const data = await loadWorkspaceData();

        if (cancelled) return;

        setWorkspaces(data.workspaces);
        setMemberships(data.roleMap);
      } catch {
        if (!cancelled) {
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

  const availableWorkspaces = useMemo<WorkspaceEntry[]>(() => {
    return workspaces.map((ws) => ({
      workspace: ws,
      role: memberships.get(ws.workspaceId) ?? "read",
    }));
  }, [workspaces, memberships]);

  const currentWorkspace = useMemo<Workspace | null>(() => {
    if (!params.workspaceSlug) {
      return workspaces.find((ws) => ws.isPersonal) ?? null;
    }
    return (
      workspaces.find(
        (ws) => ws.slug === params.workspaceSlug && ws.isPersonal,
      ) ?? null
    );
  }, [workspaces, params.workspaceSlug]);

  const currentRole = useMemo<string | null>(() => {
    if (!currentWorkspace) return null;
    return memberships.get(currentWorkspace.workspaceId) ?? null;
  }, [currentWorkspace, memberships]);

  const switchTo = useCallback(
    (workspaceSlug: string) => {
      navigate(`/${workspaceSlug}/workflows`, { replace: false });
    },
    [navigate],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      availableWorkspaces,
      currentWorkspace,
      currentOrg: null,
      orgs: [],
      currentRole,
      switchTo,
      refresh,
      isLoading,
    }),
    [
      availableWorkspaces,
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

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return ctx;
}

export default WorkspaceContext;
