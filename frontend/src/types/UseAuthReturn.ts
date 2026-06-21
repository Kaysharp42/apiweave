import type { User } from './User';
import type { AuthStatus } from './AuthStatus';
import type { DeploymentMode } from './DeploymentMode';

export interface UseAuthReturn {
  user: User | null;
  status: AuthStatus;
  error: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isSetupComplete: boolean;
  isSingleUser: boolean;
  deploymentMode: DeploymentMode;
  /**
   * True once the deployment-mode bootstrap call has resolved. Components
   * that gate redirects on deployment mode (e.g. LoginEntry) should check
   * this before issuing a Navigate to avoid a redirect ping-pong.
   */
  modeLoaded: boolean;
  login: (provider: string, inviteToken?: string) => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
}
