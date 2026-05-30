import { useAuthContext } from './AuthProvider';
import type { User } from '../types/User';
import type { AuthStatus } from '../types/AuthState';

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

export function useAuth(): UseAuthReturn {
  const { user, status, error, isSetupComplete, login, logout, refresh } = useAuthContext();

  const isLoading = status === 'loading';
  const isAuthenticated = status === 'authenticated';

  const hasPermission = (permission: string): boolean => {
    if (!user) return false;
    if (user.roles.includes('admin')) return true;
    return Array.isArray(user.permissions) && user.permissions.includes(permission);
  };

  return {
    user,
    status,
    error,
    isLoading,
    isAuthenticated,
    isSetupComplete,
    login,
    logout,
    refresh,
    hasPermission,
  };
}
