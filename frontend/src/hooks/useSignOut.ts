import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authenticatedFetch } from "../utils/authenticatedApi";
import API_BASE_URL from "../utils/api";
import { useAuth } from "../auth/useAuth";

interface UseSignOutReturn {
  signOut: () => Promise<void>;
  isSigningOut: boolean;
  error: string | null;
}

/**
 * Hook that signs the user out by calling POST /api/auth/signout,
 * clearing local auth state, and redirecting to /login.
 */
export function useSignOut(): UseSignOutReturn {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { logout } = useAuth();

  const signOut = useCallback(async () => {
    setIsSigningOut(true);
    setError(null);
    try {
      await authenticatedFetch(`${API_BASE_URL}/api/auth/signout`, {
        method: "POST",
      });
    } catch (err) {
      // Ignore network errors — clear state regardless
      if (err instanceof Error) {
        setError(err.message);
      }
    } finally {
      await logout();
      navigate("/login", { replace: true });
      setIsSigningOut(false);
    }
  }, [logout, navigate]);

  return { signOut, isSigningOut, error };
}
