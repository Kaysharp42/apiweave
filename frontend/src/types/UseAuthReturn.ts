import type { User } from './User';
import type { AuthStatus } from './AuthStatus';

export interface UseAuthReturn {
  user: User | null;
  status: AuthStatus;
  error: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isSetupComplete: boolean;
  login: (provider: string, inviteToken?: string) => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
}
