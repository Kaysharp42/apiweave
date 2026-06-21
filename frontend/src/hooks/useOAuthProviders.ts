import { useEffect, useState } from "react";
import type { ProviderDisplay } from "../types";
import type { ProviderInfo } from "../types";
import { getEnabledProviders } from "../auth/providerConfig";
import API_BASE_URL from "../utils/api";
import { authenticatedFetch } from "../utils/authenticatedApi";

interface UseOAuthProvidersReturn {
  providers: ProviderDisplay[];
  loading: boolean;
  error: string | null;
}

export function useOAuthProviders(): UseOAuthProvidersReturn {
  const [providers, setProviders] = useState<ProviderDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchProviders() {
      try {
        const res = await authenticatedFetch(
          `${API_BASE_URL}/api/auth/providers`,
        );
        if (!res.ok)
          throw new Error(`Failed to load providers (${res.status})`);
        const data: ProviderInfo[] = (await res.json()) as ProviderInfo[];
        if (!cancelled) {
          setProviders(getEnabledProviders(data));
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setError("Unable to load sign-in options");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchProviders();
    return () => {
      cancelled = true;
    };
  }, []);

  return { providers, loading, error };
}
