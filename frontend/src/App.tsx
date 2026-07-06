import {
  useState,
  useEffect,
  createContext,
  type ReactNode,
  useRef,
  useMemo,
} from "react";
import {
  BrowserRouter as Router,
  HashRouter,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import Home from "./pages/Home";
import LandingPage from "./pages/LandingPage";
import SetupPage from "./pages/SetupPage";
import { WorkspaceSecretsPage } from "./pages/WorkspaceSecretsPage";
import WorkspaceEnvironmentsPage from "./pages/WorkspaceEnvironmentsPage";
import { WorkspaceProjectPage } from "./pages/WorkspaceProjectPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PaletteProvider } from "./contexts/PaletteContext";
import { WorkspaceProvider } from "./contexts/WorkspaceContext";
import { Toast } from "./components/atoms/Toast";
import { AuthProvider } from "./auth/AuthProvider";
import { useAuth } from "./auth/useAuth";
import MainLayout from "./components/layout/MainLayout";
import useNavigationStore from "./stores/NavigationStore";
import { apiweave, authenticatedJson } from "./utils/apiweaveClient";
import API_BASE_URL from "./utils/apiweaveClient";
import { isDesktopShell } from "./utils/isDesktopShell";
import type { Workspace } from "./types/Workspace";
import type { Organization } from "./types/Organization";
import type { WorkspacePageShellProps } from "./types/WorkspacePageShellProps";

const STORAGE_PREFIX = "apiweave:v1:";

const getStoredValue = (key: string): string | null => {
  const versionedKey = `${STORAGE_PREFIX}${key}`;
  return localStorage.getItem(versionedKey) ?? localStorage.getItem(key);
};

const setStoredValue = (key: string, value: string): void => {
  localStorage.setItem(`${STORAGE_PREFIX}${key}`, value);
  localStorage.setItem(key, value);
};

export interface AppContextValue {
  darkMode: boolean;
  setDarkMode: React.Dispatch<React.SetStateAction<boolean>>;
  autoSaveEnabled: boolean;
  setAutoSaveEnabled: React.Dispatch<React.SetStateAction<boolean>>;
}

export const AppContext = createContext<AppContextValue>({
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

function DefaultWorkspaceRedirect() {
  const [targetPath, setTargetPath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [orgs, response] = await Promise.all([
        authenticatedJson<Organization[]>(`${API_BASE_URL}/api/orgs`),
        authenticatedJson<{ workspaces: Workspace[]; total: number }>(
          `${API_BASE_URL}/api/workspaces`,
        ),
      ]);
      if (cancelled) return;

      const workspace =
        response.workspaces.find((entry) => entry.isPersonal) ??
        response.workspaces[0];
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

      if (workspace.isPersonal) {
        setTargetPath(`/${workspace.slug}/workflows`);
        return;
      }

      const orgSlug = orgs.find((org) => org.orgId === workspace.orgId)?.slug;
      if (!orgSlug) {
        setTargetPath("/app");
        return;
      }
      setTargetPath(`/${orgSlug}/${workspace.slug}/workflows`);
    })().catch(() => {
      if (!cancelled) setTargetPath("/app");
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (targetPath) {
    return <Navigate to={targetPath} replace />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--aw-surface)]">
      <div className="w-8 h-8 border-4 border-[var(--aw-primary)] border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
    </div>
  );
}

function WorkspacePageShell({
  children,
  navState = "settings",
}: WorkspacePageShellProps) {
  const setNavState = useNavigationStore((state) => state.setNavState);
  const hasSet = useRef(false);

  useEffect(() => {
    if (!hasSet.current) {
      setNavState(navState);
      hasSet.current = true;
    }
  }, [setNavState, navState]);

  return (
    <ProtectedRoute>
      <WorkspaceProvider>
        <div className="relative flex flex-col h-screen font-sans text-text-primary dark:text-text-primary-dark bg-surface-raised dark:bg-surface-dark-raised">
          <MainLayout>{children}</MainLayout>
        </div>
      </WorkspaceProvider>
    </ProtectedRoute>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

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
              <Route
                path="/app"
                element={
                  <ProtectedRoute>
                    <DefaultWorkspaceRedirect />
                  </ProtectedRoute>
                }
              />
              <Route path="/login" element={<Navigate to="/app" replace />} />
              <Route path="/setup" element={<SetupEntry />} />
              <Route
                path="/personal/workflows/:workflowId"
                element={
                  <ProtectedRoute>
                    <WorkspaceProvider>
                      <Home />
                    </WorkspaceProvider>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/personal/workflows"
                element={
                  <ProtectedRoute>
                    <WorkspaceProvider>
                      <Home />
                    </WorkspaceProvider>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/:orgSlug/:workspaceSlug/settings/secrets"
                element={
                  <WorkspacePageShell>
                    <WorkspaceSecretsPage />
                  </WorkspacePageShell>
                }
              />
              <Route
                path="/:orgSlug/:workspaceSlug/settings/environments"
                element={
                  <WorkspacePageShell>
                    <WorkspaceEnvironmentsPage />
                  </WorkspacePageShell>
                }
              />
              {/* Slug-based workspace routes */}
              <Route
                path="/:orgSlug/personal"
                element={
                  <ProtectedRoute>
                    <WorkspaceProvider>
                      <Navigate to="workflows" replace />
                    </WorkspaceProvider>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/:orgSlug/:workspaceSlug"
                element={
                  <ProtectedRoute>
                    <WorkspaceProvider>
                      <Navigate to="workflows" replace />
                    </WorkspaceProvider>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/:orgSlug/:workspaceSlug/projects/:projectId"
                element={
                  <WorkspacePageShell navState="projects">
                    <WorkspaceProjectPage />
                  </WorkspacePageShell>
                }
              />
              <Route
                path="/:orgSlug/:workspaceSlug/workflows/:workflowId"
                element={
                  <ProtectedRoute>
                    <WorkspaceProvider>
                      <Home />
                    </WorkspaceProvider>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/:orgSlug/:workspaceSlug/workflows"
                element={
                  <ProtectedRoute>
                    <WorkspaceProvider>
                      <Home />
                    </WorkspaceProvider>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/*"
                element={
                  <ProtectedRoute>
                    <WorkspaceProvider>
                      <NotFoundPage />
                    </WorkspaceProvider>
                  </ProtectedRoute>
                }
              />
            </Routes>
          </RouterComponent>
        </AuthProvider>
        <Toast />
      </PaletteProvider>
    </AppContext.Provider>
  );
}

export default App;
