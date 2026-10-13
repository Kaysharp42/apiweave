import { useAuthContext } from "./AuthProvider";
import type { AuthContextValue } from "../types";

export function useAuth(): AuthContextValue {
  return useAuthContext();
}
