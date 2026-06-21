import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import type { User } from '../types/User';
import type { AuthStatus } from '../types/AuthState';
import type { DeploymentMode } from '../types/DeploymentMode';
import { authenticatedFetch, authenticatedJson } from '../utils/authenticatedApi';
import API_BASE_URL from '../utils/api';
import type { AuthContextValue } from '../types';

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [deploymentMode, setDeploymentMode] = useState<DeploymentMode>('multi_tenant');
  const [modeLoaded, setModeLoaded] = useState(false);

  const fetchMe = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const me = await authenticatedJson<User>(`${API_BASE_URL}/api/auth/me`);
      setUser(me);
      setStatus('authenticated');
    } catch (err) {
      setUser(null);
      // Default to unauthenticated. The mode-aware gate in
      // ProtectedRoute/LoginEntry/AdminRoute will not act on this state
      // until modeLoaded is true, so a stale deploymentMode cannot
      // trigger a redirect race.
      setStatus('unauthenticated');
      if (err instanceof Error) {
        setError(err.message);
      }
    }
  }, []);

  const fetchMode = useCallback(async () => {
    try {
      const mode = await authenticatedJson<{ mode: DeploymentMode }>(
        `${API_BASE_URL}/api/auth/mode`,
      );
      setDeploymentMode(mode.mode);
    } catch {
      // Safe default: treat unreachable as multi_tenant (preserves auth UI).
      setDeploymentMode('multi_tenant');
    } finally {
      setModeLoaded(true);
    }
  }, []);

  useEffect(() => {
    void fetchMe();
    void fetchMode();
  }, [fetchMe, fetchMode]);

  const login = useCallback((provider: string, inviteToken?: string) => {
    const url = new URL(`${API_BASE_URL}/api/auth/login/${provider}`);
    if (inviteToken) {
      url.searchParams.set('invite_token', inviteToken);
    }
    window.location.href = url.toString();
  }, []);

  const logout = useCallback(async () => {
    try {
      await authenticatedFetch(`${API_BASE_URL}/api/auth/logout`, { method: 'POST' });
    } catch {
      // ignore logout errors — clear state regardless
    }
    setUser(null);
    setStatus('unauthenticated');
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    await fetchMe();
  }, [fetchMe]);

  const isSetupComplete = user?.is_setup_complete ?? false;

  const value: AuthContextValue = {
    user,
    status,
    error,
    isSetupComplete,
    deploymentMode,
    modeLoaded,
    login,
    logout,
    refresh,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// Internal hook (used by useAuth.ts)
// ---------------------------------------------------------------------------

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return ctx;
}

export default AuthContext;
