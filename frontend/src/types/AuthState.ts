import type { AuthStatus } from './AuthStatus';
import type { User } from './User';

export type { AuthStatus } from './AuthStatus';

export interface AuthState {
  status: AuthStatus;
  user: User | null;
  error: string | null;
}
