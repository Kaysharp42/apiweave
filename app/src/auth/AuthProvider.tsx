import { createContext, useContext, type ReactNode } from "react";
import type { User } from "../types/User";
import type { AuthContextValue } from "../types";

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

/**
 * The desktop app has one local owner and no sign-in: access is enforced in
 * the Electron main process, so there is nothing to fetch or log out of.
 */
const LOCAL_OWNER_AUTH: AuthContextValue = {
  user: LOCAL_DESKTOP_USER,
  status: "authenticated",
  error: null,
  isSetupComplete: true,
  deploymentMode: "single_user",
  modeLoaded: true,
  login: () => undefined,
  logout: () => Promise.resolve(),
  refresh: () => Promise.resolve(),
};

export function AuthProvider({ children }: AuthProviderProps) {
  return (
    <AuthContext.Provider value={LOCAL_OWNER_AUTH}>
      {children}
    </AuthContext.Provider>
  );
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
