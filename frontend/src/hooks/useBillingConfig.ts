import { useEffect, useState } from "react";
import { authenticatedJson } from "../utils/authenticatedApi";
import API_BASE_URL from "../utils/api";

interface BillingConfig {
  billingEnabled: boolean;
  publishableKey: string;
}

/**
 * Whether hosted billing is on. When true, orgs require a Teams plan, so
 * org-creation entry points route to the Teams checkout instead of a direct
 * create (which would 402).
 */
export function useBillingConfig(): BillingConfig | null {
  const [config, setConfig] = useState<BillingConfig | null>(null);
  useEffect(() => {
    authenticatedJson<BillingConfig>(`${API_BASE_URL}/api/billing/config`)
      .then(setConfig)
      .catch(() => setConfig({ billingEnabled: false, publishableKey: "" }));
  }, []);
  return config;
}
