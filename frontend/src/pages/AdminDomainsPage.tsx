import { useCallback, useEffect, useState } from 'react';
import { MainHeader } from '../components/layout/MainHeader';
import { ApprovedDomainManager } from '../components/auth/ApprovedDomainManager';
import { Globe, Loader2, ShieldCheck } from 'lucide-react';
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
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  const providerMap = new Map(providers.map((p) => [p.id, p.enabled]));

  return (
    <div className="bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-lg overflow-hidden">
      <table className="w-full text-sm text-left">
        <thead className="text-xs text-text-secondary dark:text-text-secondary-dark uppercase bg-surface-raised dark:bg-surface-dark-raised border-b border-border dark:border-border-dark">
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
                className="border-b border-border dark:border-border-dark last:border-0 hover:bg-surface-raised dark:hover:bg-surface-dark-raised transition-colors"
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
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-success/10 text-success dark:text-success-light">
                      <span className="w-1.5 h-1.5 rounded-full bg-success dark:bg-success-light" />
                      Configured
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-surface-overlay dark:bg-surface-dark-overlay text-text-muted dark:text-text-muted-dark">
                      <span className="w-1.5 h-1.5 rounded-full bg-text-muted dark:bg-text-muted-dark" />
                      Not configured
                    </span>
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
  );
}

export default function AdminDomainsPage() {
  return (
    <div className="flex flex-col min-h-screen bg-surface dark:bg-surface-dark font-sans text-text-primary dark:text-text-primary-dark">
      <MainHeader />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-3xl mx-auto flex flex-col gap-12">
          {/* Approved Domains */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Globe className="w-6 h-6 text-primary" />
              <h1 className="text-2xl font-bold">Approved Domains</h1>
            </div>
            <p className="text-text-secondary dark:text-text-secondary-dark mb-8">
              Manage email domains that are automatically approved to sign up and join the workspace.
              Users signing up with an email from an approved domain will be granted the default
              &apos;viewer&apos; role.
            </p>
            <ApprovedDomainManager />
          </section>

          {/* SSO Provider Configuration */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="w-6 h-6 text-primary" />
              <h2 className="text-2xl font-bold">SSO Provider Configuration</h2>
            </div>
            <p className="text-text-secondary dark:text-text-secondary-dark mb-8">
              View the configuration status of the supported SSO providers. Providers are enabled by
              setting the corresponding environment variables on the backend.
            </p>
            <SsoProviderSection />
          </section>
        </div>
      </main>
    </div>
  );
}
