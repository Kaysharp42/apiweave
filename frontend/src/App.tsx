import { useState, useEffect, createContext, type ReactNode, useRef, useMemo } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
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
import { PaletteProvider } from './contexts/PaletteContext';
import { WorkspaceProvider } from './contexts/WorkspaceContext';
import { Toast } from './components/atoms/Toast';
import { AuthProvider } from './auth/AuthProvider';
import { useAuth } from './auth/useAuth';
import { AdminRoute } from './auth/AdminRoute';
import MainLayout from './components/layout/MainLayout';
import useNavigationStore from './stores/NavigationStore';

const STORAGE_PREFIX = 'apiweave:v1:';

const getStoredValue = (key: string): string | null => {
  const versionedKey = `${STORAGE_PREFIX}${key}`;
  return localStorage.getItem(versionedKey) ?? localStorage.getItem(key);
};

const setStoredValue = (key: string, value: string): void => {
  localStorage.setItem(`${STORAGE_PREFIX}${key}`, value);
  localStorage.setItem(key, value);
};

interface AppContextValue {
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
      <div className="relative flex flex-col h-screen font-sans text-text-primary dark:text-text-primary-dark bg-surface-raised dark:bg-surface-dark-raised">
        <MainLayout>{children}</MainLayout>
      </div>
    </AdminRoute>
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
              <Route path="/login" element={<LoginPage />} />
              <Route path="/setup" element={<SetupPage />} />
              <Route path="/invite/:token" element={<InvitePage />} />
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
                  <ProtectedRoute>
                    <AccountSettingsPage />
                  </ProtectedRoute>
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
                  <ProtectedRoute>
                    <AuditPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/:orgSlug/:workspaceSlug/settings/secrets"
                element={
                  <ProtectedRoute>
                    <WorkspaceSecretsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/:orgSlug/:workspaceSlug/settings/tokens"
                element={
                  <ProtectedRoute>
                    <WorkspaceTokensPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/:orgSlug/:workspaceSlug/settings/environments"
                element={
                  <ProtectedRoute>
                    <WorkspaceEnvironmentsPage />
                  </ProtectedRoute>
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
                  <ProtectedRoute>
                    <WorkspaceProvider>
                      <Home />
                    </WorkspaceProvider>
                  </ProtectedRoute>
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
                      <Home />
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
