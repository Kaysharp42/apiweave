import type { User } from './User';
import type { AuthStatus } from './AuthStatus';

export interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  error: string | null;
  isSetupComplete: boolean;
  login: (provider: string, inviteToken?: string) => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}
