import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useNavigate, useParams } from "react-router";
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

  /**
   * A route can name a workspace this list has not loaded: an agent created it
   * over MCP, or a git import opened it, and the notice that says so is a
   * one-shot broadcast — a renderer that was not listening when it landed
   * (no shell route mounted, a reload, a listener not yet subscribed) never
   * hears it. A miss is therefore not proof the workspace is gone, and treating
   * it as one leaves every workspace settings page — Secrets, Environments,
   * Version history — on "Workspace unavailable" until the app restarts, which
   * is exactly what it did for a workspace an agent had just created.
   *
   * So a miss refetches the list once for that slug. One retry, keyed by slug:
   * a workspace that really does not exist costs one local SQLite read and then
   * settles, while one that exists appears without the user doing anything.
   */
  const retriedSlug = useRef<string | null>(null);
  const missingSlug = params.workspaceSlug;
  const resolved = currentWorkspace !== null;

  useEffect(() => {
    if (resolved) {
      retriedSlug.current = null;
      return;
    }
    if (isLoading || missingSlug === undefined) return;
    if (retriedSlug.current === missingSlug) return;
    retriedSlug.current = missingSlug;
    void refresh();
  }, [isLoading, missingSlug, refresh, resolved]);

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
