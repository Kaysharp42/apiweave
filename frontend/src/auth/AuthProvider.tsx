import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { User } from "../types/User";
import type { AuthStatus } from "../types/AuthState";
import type { DeploymentMode } from "../types/DeploymentMode";
import { authenticatedFetch, authenticatedJson } from "../utils/apiweaveClient";
import API_BASE_URL from "../utils/apiweaveClient";
import type { AuthContextValue } from "../types";
import { isDesktopShell } from "../utils/isDesktopShell";

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

const LOCAL_DESKTOP_USER: User = {
  userId: "usr-single-user-owner",
  verified_email: "local@apiweave.desktop",
  display_name: "Local owner",
  avatar_url: null,
  roles: ["admin"],
  permissions: ["*"],
  oauth_accounts: [],
  is_setup_complete: true,
  created_at: "2026-01-01T00:00:00.000Z",
};

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(() =>
    isDesktopShell() ? LOCAL_DESKTOP_USER : null,
  );
  const [status, setStatus] = useState<AuthStatus>(() =>
    isDesktopShell() ? "authenticated" : "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const [deploymentMode, setDeploymentMode] = useState<DeploymentMode>(() =>
    isDesktopShell() ? "single_user" : "multi_tenant",
  );
  const [modeLoaded, setModeLoaded] = useState(() => isDesktopShell());

  const fetchMe = useCallback(async () => {
    if (isDesktopShell()) {
      setUser(LOCAL_DESKTOP_USER);
      setStatus("authenticated");
      setError(null);
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const me = await authenticatedJson<User>(`${API_BASE_URL}/api/auth/me`);
      setUser(me);
      setStatus("authenticated");
    } catch (err) {
      setUser(null);
      // Default to unauthenticated. The mode-aware gate in
      // ProtectedRoute/LoginEntry/AdminRoute will not act on this state
      // until modeLoaded is true, so a stale deploymentMode cannot
      // trigger a redirect race.
      setStatus("unauthenticated");
      if (err instanceof Error) {
        setError(err.message);
      }
    }
  }, []);

  const fetchMode = useCallback(async () => {
    if (isDesktopShell()) {
      setDeploymentMode("single_user");
      setModeLoaded(true);
      return;
    }
    try {
      const mode = await authenticatedJson<{ mode: DeploymentMode }>(
        `${API_BASE_URL}/api/auth/mode`,
      );
      setDeploymentMode(mode.mode);
    } catch {
      // Safe default: treat unreachable as multi_tenant (preserves auth UI).
      setDeploymentMode("multi_tenant");
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
      url.searchParams.set("invite_token", inviteToken);
    }
    window.location.href = url.toString();
  }, []);

  const logout = useCallback(async () => {
    if (isDesktopShell()) {
      setUser(LOCAL_DESKTOP_USER);
      setStatus("authenticated");
      setError(null);
      return;
    }
    try {
      await authenticatedFetch(`${API_BASE_URL}/api/auth/logout`, {
        method: "POST",
      });
    } catch {
      // ignore logout errors — clear state regardless
    }
    setUser(null);
    setStatus("unauthenticated");
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
    throw new Error("useAuthContext must be used within an AuthProvider");
  }
  return ctx;
}

export default AuthContext;
