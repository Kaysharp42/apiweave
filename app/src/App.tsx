import {
  useState,
  useEffect,
  useLayoutEffect,
  useContext,
  createContext,
  type ReactNode,
  useMemo,
} from "react";
import {
  BrowserRouter as Router,
  HashRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
} from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import SetupPage from "./pages/SetupPage";
import { WorkspaceSecretsPage } from "./pages/WorkspaceSecretsPage";
import WorkspaceEnvironmentsPage from "./pages/WorkspaceEnvironmentsPage";
import { WorkspaceProjectPage } from "./pages/WorkspaceProjectPage";
import { ConflictDetailPage } from "./pages/cloud/ConflictDetailPage";
import { ConflictsPage } from "./pages/cloud/ConflictsPage";
import { CloudSyncPage } from "./pages/cloud/CloudSyncPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PaletteProvider } from "./contexts/PaletteContext";
import { WorkspaceProvider } from "./contexts/WorkspaceContext";
import { Toast } from "./components/atoms/Toast";
import { AuthProvider } from "./auth/AuthProvider";
import { useAuth } from "./auth/useAuth";
import MainLayout from "./components/layout/MainLayout";
import useNavigationStore from "./stores/NavigationStore";
import { useAccountSessionReset } from "./hooks/useAccountSessionReset";
import { apiweave } from "./utils/apiweaveClient";
import { isDesktopShell } from "./utils/isDesktopShell";
import { getLastWorkspaceSlug } from "./utils/workspacePreference";
import type { Workspace } from "./types/Workspace";
import { CanvasSurfaceContext } from "./contexts/CanvasSurfaceContext";
import type { WorkspacePageRouteProps } from "./types/WorkspacePageRouteProps";
import type { AppContextType } from "./types/AppContextType";

const STORAGE_PREFIX = "apiweave:v1:";

const getStoredValue = (key: string): string | null => {
  const versionedKey = `${STORAGE_PREFIX}${key}`;
  return localStorage.getItem(versionedKey) ?? localStorage.getItem(key);
};

const setStoredValue = (key: string, value: string): void => {
  localStorage.setItem(`${STORAGE_PREFIX}${key}`, value);
  localStorage.setItem(key, value);
};

export const AppContext = createContext<AppContextType>({
  darkMode: false,
  setDarkMode: () => {},
  autoSaveEnabled: true,
  setAutoSaveEnabled: () => {},
});

// ---------------------------------------------------------------------------
// ProtectedRoute — shows spinner while loading, redirects when unauthenticated
// ---------------------------------------------------------------------------

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status, deploymentMode, modeLoaded, error } = useAuth();

  if (status === "loading" || !modeLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--aw-surface)]">
        <div className="w-8 h-8 border-4 border-[var(--aw-primary)] border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
      </div>
    );
  }

  // In single-user mode, an unauthenticated /me response is a backend bug,
  // not a sign that the user needs to log in. Surface the error instead
  // of redirecting to /login (which would just bounce back via LoginEntry).
  if (status === "unauthenticated" && deploymentMode === "single_user") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--aw-surface)] p-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold text-text-primary dark:text-text-primary-dark">
            Auth bootstrap failed
          </h1>
          <p className="mt-2 text-sm text-text-secondary dark:text-text-secondary-dark">
            Single-user mode requires <code>/api/auth/me</code> to succeed. The
            backend did not return a user.
          </p>
          {error !== null && (
            <p className="mt-3 text-xs font-mono text-text-tertiary dark:text-text-tertiary-dark break-words">
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <Navigate to="/app" replace />;
  }

  return <>{children}</>;
}

// Reopen the workspace the user last had selected, as long as it still
// exists. Falls back to the personal workspace (then the first available)
// when there is no remembered slug or it has been removed.
function pickDefaultWorkspace(
  workspaces: readonly Workspace[],
  lastSlug: string | null,
): Workspace | undefined {
  const lastMatch = lastSlug
    ? workspaces.find((entry) => entry.slug === lastSlug)
    : undefined;
  return (
    lastMatch ?? workspaces.find((entry) => entry.isPersonal) ?? workspaces[0]
  );
}

function DefaultWorkspaceRedirect() {
  const [targetPath, setTargetPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const workspaces = await apiweave.workspaces.list();
        if (cancelled) return;

        const workspace = pickDefaultWorkspace(
          workspaces,
          getLastWorkspaceSlug(),
        );
        if (!workspace) {
          if (isDesktopShell()) {
            await apiweave.workspaces.create({
              name: "Personal",
              slug: "personal",
              isPersonal: true,
            });
            setTargetPath("/personal/workflows");
            return;
          }
          setTargetPath("/setup");
          return;
        }

        setTargetPath(`/${workspace.slug}/workflows`);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load workspaces. Please restart the app.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--aw-surface)] p-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold text-text-primary dark:text-text-primary-dark">
            Failed to load workspace
          </h1>
          <p className="mt-2 text-sm text-text-secondary dark:text-text-secondary-dark">
            {error}
          </p>
        </div>
      </div>
    );
  }

  if (targetPath) {
    return <Navigate to={targetPath} replace />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--aw-surface)]">
      <div className="w-8 h-8 border-4 border-[var(--aw-primary)] border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
    </div>
  );
}

/**
 * Auth and the workspace list for every signed-in route, mounted once above the
 * router's outlet instead of once per route element.
 *
 * A pathless layout route, deliberately. When each route built its own
 * `ProtectedRoute` → `WorkspaceProvider` → shell tree, a hop between two of
 * them handed React a different component type in the same position, so it tore
 * the subtree down and built a new one: the workspace list was refetched, the
 * canvas and its ReactFlow instance were recreated, and the window sat blank for
 * ~150ms every trip in or out of Settings. Sharing one parent element keeps
 * these instances mounted across those navigations and swaps only what
 * `<Outlet />` renders.
 */
function AuthedRoutes() {
  return (
    <ProtectedRoute>
      <WorkspaceProvider>
        <Outlet />
      </WorkspaceProvider>
    </ProtectedRoute>
  );
}

/**
 * The app chrome — header, nav rail, sidebar, agent pane, footer — for the
 * routes that show it, nested inside `AuthedRoutes` so the providers above it
 * persist too. See the note there for why this is a layout route rather than a
 * wrapper each route renders for itself.
 */
function AppShellRoutes() {
  return (
    <div className="relative flex h-screen flex-col bg-surface font-sans text-text-primary dark:bg-surface-dark dark:text-text-primary-dark">
      <MainLayout>
        <Outlet />
      </MainLayout>
    </div>
  );
}

/**
 * What a workflows path renders: nothing.
 *
 * The canvas is not a route element — `MainLayout` keeps one mounted for the
 * whole session, so a route that produced it would unmount it on the way to
 * Settings and rebuild it on the way back. Explicitly nothing rather than an
 * elementless `<Route>`, which React Router warns about as a likely mistake.
 */
const CanvasRoute = () => null;

/**
 * A page that sits over the canvas: the settings pages and a project's page.
 *
 * It owns the two things a page has to say for itself now that the shell
 * outlives the route:
 *
 * - **Its nav section.** The shell was rebuilt on every navigation before, so
 *   claiming the section once per shell mount was enough. `MainLayout` still
 *   owns the way back out — it drops "settings" as soon as the path stops being
 *   a settings route.
 * - **That the canvas is covered.** `MainLayout` keeps one canvas mounted for
 *   the whole session; this is what tells it to stand down. `useLayoutEffect`
 *   rather than `useEffect` so the canvas is hidden in the same commit that
 *   paints this surface, with no frame showing both.
 *
 * The surface is absolute and opaque so the canvas keeps its own box underneath
 * and never sees a resize — see the note on `content` in `MainLayout`.
 */
function WorkspacePageRoute({
  children,
  navState = "settings",
}: WorkspacePageRouteProps) {
  const setNavState = useNavigationStore((state) => state.setNavState);
  const { setCovered } = useContext(CanvasSurfaceContext);

  useEffect(() => {
    setNavState(navState);
  }, [setNavState, navState]);

  useLayoutEffect(() => {
    setCovered(true);
    return () => setCovered(false);
  }, [setCovered]);

  return (
    <div className="absolute inset-0 z-10 overflow-hidden bg-surface dark:bg-surface-dark">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

/** Drops session-scoped UI state when the linked cloud account changes. */
function AccountSessionReset() {
  useAccountSessionReset();
  return null;
}

function SetupEntry() {
  const { status, isSingleUser, isAuthenticated, modeLoaded, error } =
    useAuth();

  if (status === "loading" || !modeLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--aw-surface)]">
        <div className="w-8 h-8 border-4 border-[var(--aw-primary)] border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
      </div>
    );
  }

  if (isSingleUser) {
    if (isAuthenticated) {
      return <Navigate to="/app" replace />;
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--aw-surface)] p-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold text-text-primary dark:text-text-primary-dark">
            Auth bootstrap failed
          </h1>
          <p className="mt-2 text-sm text-text-secondary dark:text-text-secondary-dark">
            Single-user mode requires <code>/api/auth/me</code> to succeed.
          </p>
          {error !== null && (
            <p className="mt-3 text-xs font-mono text-text-tertiary dark:text-text-tertiary-dark break-words">
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  return <SetupPage />;
}

function App() {
  const [darkMode, setDarkMode] = useState(() => {
    try {
      const stored = getStoredValue("darkMode");
      if (stored !== null) return stored === "true";
      return (
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
      );
    } catch {
      return false;
    }
  });

  const [autoSaveEnabled, setAutoSaveEnabled] = useState(() => {
    try {
      const stored = getStoredValue("autoSaveEnabled");
      if (stored !== null) return stored === "true";
      return true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      if (darkMode) {
        document.documentElement.classList.add("dark");
        document.documentElement.setAttribute("data-theme", "apiweave-dark");
      } else {
        document.documentElement.classList.remove("dark");
        document.documentElement.setAttribute("data-theme", "apiweave");
      }
      setStoredValue("darkMode", darkMode ? "true" : "false");
    } catch {
      // ignore
    }
  }, [darkMode]);

  useEffect(() => {
    try {
      setStoredValue("autoSaveEnabled", autoSaveEnabled ? "true" : "false");
    } catch {
      // ignore
    }
  }, [autoSaveEnabled]);

  const appContextValue = useMemo(
    () => ({ darkMode, setDarkMode, autoSaveEnabled, setAutoSaveEnabled }),
    [darkMode, autoSaveEnabled],
  );
  const RouterComponent = isDesktopShell() ? HashRouter : Router;

  return (
    <AppContext.Provider value={appContextValue}>
      <PaletteProvider>
        <AuthProvider>
          <RouterComponent>
            <AccountSessionReset />
            <Routes>
              {/* Desktop skips the marketing landing page — no login needed
                  (single-user backend), so go straight to the workspace. */}
              <Route
                path="/"
                element={
                  isDesktopShell() ? (
                    <Navigate to="/app" replace />
                  ) : (
                    <LandingPage />
                  )
                }
              />
              <Route path="/login" element={<Navigate to="/app" replace />} />
              <Route path="/setup" element={<SetupEntry />} />

              {/* Every signed-in route shares one auth + workspace parent, so
                  moving between them never remounts the providers. */}
              <Route element={<AuthedRoutes />}>
                <Route path="/app" element={<DefaultWorkspaceRedirect />} />

                <Route
                  path="/cloud/conflicts/:conflictId"
                  element={<ConflictDetailPage />}
                />
                <Route path="/cloud/conflicts" element={<ConflictsPage />} />
                <Route path="/cloud/sync" element={<CloudSyncPage />} />

                {/* Slug-based workspace routes. Redirects only, kept outside
                    the shell so they never paint an empty one on the way
                    through. */}
                <Route
                  path="/:orgSlug/personal"
                  element={<Navigate to="workflows" replace />}
                />
                <Route
                  path="/:orgSlug/:workspaceSlug"
                  element={<Navigate to="workflows" replace />}
                />

                {/* Everything that shows the app chrome. One shell element for
                    all of them is what keeps a hop between the canvas and
                    Settings from rebuilding the app. */}
                <Route element={<AppShellRoutes />}>
                  {/* These match the shell and put nothing over the canvas
                      it already holds — see `CanvasRoute`. */}
                  <Route
                    path="/:workspaceSlug/workflows"
                    element={<CanvasRoute />}
                  />
                  <Route
                    path="/:workspaceSlug/workflows/:workflowId"
                    element={<CanvasRoute />}
                  />
                  <Route
                    path="/:orgSlug/:workspaceSlug/workflows"
                    element={<CanvasRoute />}
                  />
                  <Route
                    path="/:orgSlug/:workspaceSlug/workflows/:workflowId"
                    element={<CanvasRoute />}
                  />

                  <Route
                    path="/:orgSlug/:workspaceSlug/settings/environments"
                    element={
                      <WorkspacePageRoute>
                        <WorkspaceEnvironmentsPage />
                      </WorkspacePageRoute>
                    }
                  />
                  <Route
                    path="/:orgSlug/:workspaceSlug/settings/secrets"
                    element={
                      <WorkspacePageRoute>
                        <WorkspaceSecretsPage />
                      </WorkspacePageRoute>
                    }
                  />
                  <Route
                    path="/:orgSlug/:workspaceSlug/projects/:projectId"
                    element={
                      <WorkspacePageRoute navState="projects">
                        <WorkspaceProjectPage />
                      </WorkspacePageRoute>
                    }
                  />
                </Route>

                <Route path="/*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </RouterComponent>
        </AuthProvider>
        <Toast />
      </PaletteProvider>
    </AppContext.Provider>
  );
}

export default App;
