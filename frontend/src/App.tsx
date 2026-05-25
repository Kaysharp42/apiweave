import { useState, useEffect, createContext, type ReactNode } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import LoginPage from './pages/LoginPage';
import SetupPage from './pages/SetupPage';
import InvitePage from './pages/InvitePage';
import AdminUsersPage from './pages/AdminUsersPage';
import AdminDomainsPage from './pages/AdminDomainsPage';
import { PaletteProvider } from './contexts/PaletteContext';
import { Toast } from './components/atoms/Toast';
import { AuthProvider } from './auth/AuthProvider';
import { useAuth } from './auth/useAuth';
import { AdminRoute } from './auth/AdminRoute';

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
      <div className="min-h-screen flex items-center justify-center bg-surface dark:bg-surface-dark">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function App() {
  const [darkMode, setDarkMode] = useState(() => {
    try {
      const stored = localStorage.getItem('darkMode');
      if (stored !== null) return stored === 'true';
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  });

  const [autoSaveEnabled, setAutoSaveEnabled] = useState(() => {
    try {
      const stored = localStorage.getItem('autoSaveEnabled');
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
      localStorage.setItem('darkMode', darkMode ? 'true' : 'false');
    } catch {
      // ignore
    }
  }, [darkMode]);

  useEffect(() => {
    try {
      localStorage.setItem('autoSaveEnabled', autoSaveEnabled ? 'true' : 'false');
    } catch {
      // ignore
    }
  }, [autoSaveEnabled]);

  return (
    <AppContext.Provider value={{ darkMode, setDarkMode, autoSaveEnabled, setAutoSaveEnabled }}>
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
                  <AdminRoute>
                    <AdminUsersPage />
                  </AdminRoute>
                }
              />
              <Route
                path="/settings/domains"
                element={
                  <AdminRoute>
                    <AdminDomainsPage />
                  </AdminRoute>
                }
              />
              <Route
                path="/*"
                element={
                  <ProtectedRoute>
                    <Home />
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
