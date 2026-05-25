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
import { authenticatedFetch, authenticatedJson } from '../utils/authenticatedApi';
import API_BASE_URL from '../utils/api';

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

export interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  error: string | null;
  isSetupComplete: boolean;
  login: (provider: string) => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

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

  const fetchMe = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const me = await authenticatedJson<User>(`${API_BASE_URL}/api/auth/me`);
      setUser(me);
      setStatus('authenticated');
    } catch (err) {
      setUser(null);
      setStatus('unauthenticated');
      if (err instanceof Error) {
        setError(err.message);
      }
    }
  }, []);

  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  const login = useCallback((provider: string) => {
    window.location.href = `${API_BASE_URL}/api/auth/login/${provider}`;
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
