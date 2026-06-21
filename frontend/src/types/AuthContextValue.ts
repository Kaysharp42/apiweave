import type { User } from "./User";
import type { AuthStatus } from "./AuthStatus";
import type { DeploymentMode } from "./DeploymentMode";

export interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  error: string | null;
  isSetupComplete: boolean;
  deploymentMode: DeploymentMode;
  /**
   * True once the deployment-mode bootstrap call to `/api/auth/mode` has
   * resolved. Route gates (ProtectedRoute, LoginEntry, AdminRoute) must
   * not redirect to /login or /app until this is true, otherwise a race
   * between /me and /mode fetches causes a Navigate ping-pong in
   * single-user mode.
   */
  modeLoaded: boolean;
  login: (provider: string, inviteToken?: string) => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}
