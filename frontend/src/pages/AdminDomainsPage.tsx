import { useCallback, useEffect, useState } from 'react';
import { ApprovedDomainManager } from '../components/auth/ApprovedDomainManager';
import { Globe, ShieldCheck } from 'lucide-react';
import { Spinner } from '../components/atoms/Spinner';
import { StatusBadge } from '../components/molecules/StatusBadge';
import { Panel } from '../components/molecules/Panel';
import { authenticatedJson } from '../utils/authenticatedApi';
import API_BASE_URL from '../utils/api';
import { PROVIDER_DISPLAY_MAP, PROVIDER_IDS } from '../auth/providerConfig';
import type { ProviderId } from '../auth/providerConfig';
import { toast } from 'sonner';

interface ProviderStatus {
  id: string;
  enabled: boolean;
}

function SsoProviderSection() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProviders = useCallback(async () => {
    try {
      setLoading(true);
      const data = await authenticatedJson<ProviderStatus[]>(
        `${API_BASE_URL}/api/settings/providers`
      );
      setProviders(data);
    } catch {
      toast.error('Failed to load SSO provider status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProviders();
  }, [fetchProviders]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-text-muted">
        <Spinner size="lg" className="text-primary dark:text-primary-light" />
      </div>
    );
  }

  const providerMap = new Map(providers.map((p) => [p.id, p.enabled]));

  return (
    <Panel title="SSO Provider Configuration">
      <div className="overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-text-secondary dark:text-text-secondary-dark uppercase bg-surface-overlay dark:bg-surface-dark-overlay border-b border-border dark:border-border-dark">
            <tr>
              <th className="px-6 py-3">Provider</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Configuration</th>
            </tr>
          </thead>
          <tbody>
            {PROVIDER_IDS.map((id) => {
              const display = PROVIDER_DISPLAY_MAP[id as ProviderId];
              const enabled = providerMap.get(id) ?? false;
              const { IconComponent } = display;

              return (
                <tr
                  key={id}
                  className="border-b border-border dark:border-border-dark last:border-0 hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors focus-within:outline-2 focus-within:outline-[var(--aw-primary)] focus-within:outline-offset-[-2px]"
                  tabIndex={0}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <IconComponent className="w-4 h-4 text-text-secondary dark:text-text-secondary-dark" />
                      <span className="font-medium text-text-primary dark:text-text-primary-dark capitalize">
                        {id}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {enabled ? (
                      <StatusBadge status="success" label="Configured" />
                    ) : (
                      <StatusBadge status="idle" label="Not configured" />
                    )}
                  </td>
                  <td className="px-6 py-4 text-xs text-text-secondary dark:text-text-secondary-dark">
                    {enabled
                      ? 'Client ID and secret are set in environment variables.'
                      : `Set ${id.toUpperCase()}_CLIENT_ID and ${id.toUpperCase()}_CLIENT_SECRET in the backend environment to enable.`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export default function AdminDomainsPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-6 border-b border-border dark:border-border-dark bg-surface dark:bg-surface-dark">
        <Globe className="w-5 h-5 text-text-secondary dark:text-text-secondary-dark" />
        <div>
          <h1 className="text-3xl font-bold font-display tracking-tight text-text-primary dark:text-text-primary-dark">
            Domain &amp; SSO Settings
          </h1>
          <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
            Manage approved email domains and SSO providers
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-8">
          {/* Approved Domains */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Globe className="w-4 h-4 text-text-secondary dark:text-text-secondary-dark" />
              <h2 className="text-lg font-semibold text-text-primary dark:text-text-primary-dark">
                Approved Domains
              </h2>
            </div>
            <p className="text-sm text-text-secondary dark:text-text-secondary-dark mb-4">
              Manage email domains that are automatically approved to sign up and join the workspace.
              Users signing up with an email from an approved domain will be granted the default
              &apos;viewer&apos; role.
            </p>
            <ApprovedDomainManager />
          </section>

          {/* SSO Provider Configuration */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck className="w-4 h-4 text-text-secondary dark:text-text-secondary-dark" />
              <h2 className="text-lg font-semibold text-text-primary dark:text-text-primary-dark">
                SSO Provider Configuration
              </h2>
            </div>
            <p className="text-sm text-text-secondary dark:text-text-secondary-dark mb-4">
              View the configuration status of the supported SSO providers. Providers are enabled by
              setting the corresponding environment variables on the backend.
            </p>
            <SsoProviderSection />
          </section>
        </div>
      </div>
    </div>
  );
}
