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
import type { WorkspaceContextValue } from "../types/WorkspaceContextValue";
import { apiweave } from "../utils/apiweaveClient";
import { setLastWorkspaceSlug } from "../utils/workspacePreference";

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

interface WorkspaceProviderProps {
  children: ReactNode;
}

async function loadWorkspaces(): Promise<Workspace[]> {
  return [...(await apiweave.workspaces.list())];
}

export function WorkspaceProvider({ children }: WorkspaceProviderProps) {
  const navigate = useNavigate();
  const params = useParams<{ orgSlug?: string; workspaceSlug?: string }>();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setWorkspaces(await loadWorkspaces());
    } catch {
      setWorkspaces([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      try {
        const loaded = await loadWorkspaces();

        if (cancelled) return;

        setWorkspaces(loaded);
      } catch {
        if (!cancelled) {
          setWorkspaces([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const currentWorkspace = useMemo<Workspace | null>(() => {
    if (!params.workspaceSlug) {
      return workspaces.find((ws) => ws.isPersonal) ?? null;
    }
    return workspaces.find((ws) => ws.slug === params.workspaceSlug) ?? null;
  }, [workspaces, params.workspaceSlug]);

  const switchTo = useCallback(
    (workspaceSlug: string) => {
      setLastWorkspaceSlug(workspaceSlug);
      navigate(`/${params.orgSlug ?? "personal"}/${workspaceSlug}/workflows`, {
        replace: false,
      });
    },
    [navigate, params.orgSlug],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      availableWorkspaces: workspaces,
      currentWorkspace,
      currentOrg: null,
      orgs: [],
      switchTo,
      refresh,
      isLoading,
    }),
    [workspaces, currentWorkspace, switchTo, refresh, isLoading],
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
