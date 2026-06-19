import { useState, useEffect, createContext, type ReactNode, useRef, useMemo } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import SetupPage from './pages/SetupPage';
import InvitePage from './pages/InvitePage';
import AdminUsersPage from './pages/AdminUsersPage';
import AdminDomainsPage from './pages/AdminDomainsPage';
import AccountSettingsPage from './pages/AccountSettingsPage';
import InviteAdminPage from './pages/InviteAdminPage';
import AuditPage from './pages/AuditPage';
import { WorkspaceSecretsPage } from './pages/WorkspaceSecretsPage';
import { WorkspaceTokensPage } from './pages/WorkspaceTokensPage';
import WorkspaceEnvironmentsPage from './pages/WorkspaceEnvironmentsPage';
import OrgSettingsPage from './pages/OrgSettingsPage';
import { WorkspaceProjectPage } from './pages/WorkspaceProjectPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PaletteProvider } from './contexts/PaletteContext';
import { WorkspaceProvider } from './contexts/WorkspaceContext';
import { Toast } from './components/atoms/Toast';
import { AuthProvider } from './auth/AuthProvider';
import { useAuth } from './auth/useAuth';
import { AdminRoute } from './auth/AdminRoute';
import MainLayout from './components/layout/MainLayout';
import useNavigationStore from './stores/NavigationStore';
import { authenticatedJson } from './utils/authenticatedApi';
import API_BASE_URL from './utils/api';
import type { Workspace } from './types/Workspace';
import type { Organization } from './types/Organization';
import type { WorkspacePageShellProps } from './types/WorkspacePageShellProps';

const STORAGE_PREFIX = 'apiweave:v1:';

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
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--aw-surface)]">
        <div className="w-8 h-8 border-4 border-[var(--aw-primary)] border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
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

      const workspace = response.workspaces.find((entry) => entry.isPersonal) ?? response.workspaces[0];
      if (!workspace) {
        setTargetPath('/setup');
        return;
      }

      if (workspace.isPersonal) {
        setTargetPath(`/${workspace.slug}/workflows`);
        return;
      }

      const orgSlug = orgs.find((org) => org.orgId === workspace.orgId)?.slug;
      if (!orgSlug) {
        setTargetPath('/login');
        return;
      }
      setTargetPath(`/${orgSlug}/${workspace.slug}/workflows`);
    })().catch(() => {
      if (!cancelled) setTargetPath('/login');
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

// ---------------------------------------------------------------------------
// AdminPageShell — wraps admin pages in the full app layout
// ---------------------------------------------------------------------------

function AdminPageShell({ children }: { children: ReactNode }) {
  const setNavState = useNavigationStore((state) => state.setNavState);
  const hasSet = useRef(false);

  useEffect(() => {
    if (!hasSet.current) {
      setNavState('settings');
      hasSet.current = true;
    }
  }, [setNavState]);

  return (
    <AdminRoute>
      <WorkspaceProvider>
        <div className="relative flex flex-col h-screen font-sans text-text-primary dark:text-text-primary-dark bg-surface-raised dark:bg-surface-dark-raised">
          <MainLayout>{children}</MainLayout>
        </div>
      </WorkspaceProvider>
    </AdminRoute>
  );
}

function WorkspacePageShell({ children, navState = 'settings' }: WorkspacePageShellProps) {
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

function App() {
  const [darkMode, setDarkMode] = useState(() => {
    try {
      const stored = getStoredValue('darkMode');
      if (stored !== null) return stored === 'true';
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  });

  const [autoSaveEnabled, setAutoSaveEnabled] = useState(() => {
    try {
      const stored = getStoredValue('autoSaveEnabled');
      if (stored !== null) return stored === 'true';
      return true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      if (darkMode) {
        document.documentElement.classList.add('dark');
        document.documentElement.setAttribute('data-theme', 'apiweave-dark');
      } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.setAttribute('data-theme', 'apiweave');
      }
      setStoredValue('darkMode', darkMode ? 'true' : 'false');
    } catch {
      // ignore
    }
  }, [darkMode]);

  useEffect(() => {
    try {
      setStoredValue('autoSaveEnabled', autoSaveEnabled ? 'true' : 'false');
    } catch {
      // ignore
    }
  }, [autoSaveEnabled]);

  const appContextValue = useMemo(
    () => ({ darkMode, setDarkMode, autoSaveEnabled, setAutoSaveEnabled }),
    [darkMode, autoSaveEnabled],
  );

  return (
    <AppContext.Provider value={appContextValue}>
      <PaletteProvider>
        <AuthProvider>
          <Router>
            <Routes>
              <Route
                path="/"
                element={<LandingPage />}
              />
              <Route
                path="/app"
                element={
                  <ProtectedRoute>
                    <DefaultWorkspaceRedirect />
                  </ProtectedRoute>
                }
              />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/setup" element={<SetupPage />} />
              <Route path="/invite/:token" element={<InvitePage />} />
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
                path="/settings/users"
                element={
                  <AdminPageShell>
                    <AdminUsersPage />
                  </AdminPageShell>
                }
              />
              <Route
                path="/settings/domains"
                element={
                  <AdminPageShell>
                    <AdminDomainsPage />
                  </AdminPageShell>
                }
              />
              <Route
                path="/settings/account"
                element={
                  <WorkspacePageShell>
                    <AccountSettingsPage />
                  </WorkspacePageShell>
                }
              />
              <Route
                path="/settings/invites"
                element={
                  <AdminPageShell>
                    <InviteAdminPage />
                  </AdminPageShell>
                }
              />
              <Route
                path="/audit"
                element={
                  <WorkspacePageShell>
                    <AuditPage />
                  </WorkspacePageShell>
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
                path="/:orgSlug/:workspaceSlug/settings/tokens"
                element={
                  <WorkspacePageShell>
                    <WorkspaceTokensPage />
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
              <Route
                path="/:orgSlug/:workspaceSlug/settings/org"
                element={
                  <WorkspacePageShell>
                    <OrgSettingsPage />
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
          </Router>
        </AuthProvider>
        <Toast />
      </PaletteProvider>
    </AppContext.Provider>
  );
}

export default App;
