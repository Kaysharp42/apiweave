import { useEffect, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import {
  PROVIDER_DISPLAY_MAP,
  getEnabledProviders,
  type ProviderDisplay,
} from '../auth/providerConfig';
import { Button } from '../components/atoms/Button';
import { Card } from '../components/molecules/Card';
import { SplitAuthLayout } from '../components/auth/SplitAuthLayout';
import { AuthInteractiveHero } from '../components/auth/AuthInteractiveHero';
import type { ProviderInfo } from '../types/ProviderInfo';
import API_BASE_URL from '../utils/api';

export default function InvitePage() {
  const { login, status } = useAuth();
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');
  const [providers, setProviders] = useState<ProviderDisplay[]>([]);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [providersLoading, setProvidersLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadProviders() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/providers`);

        if (!res.ok) {
          throw new Error('Failed to load providers');
        }

        const data: ProviderInfo[] = await res.json();

        if (!cancelled) {
          setProviders(getEnabledProviders(data));
        }
      } catch {
        if (!cancelled) {
          setProviderError('Unable to load sign-in options');
        }
      } finally {
        if (!cancelled) {
          setProvidersLoading(false);
        }
      }
    }

    loadProviders();

    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface dark:bg-surface-dark">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  return (
    <SplitAuthLayout hero={<AuthInteractiveHero />}>
      <Card className="w-full shadow-lg">
        <div className="p-8 text-center border-b border-border dark:border-border-dark">
          <h1 className="text-2xl font-display font-bold text-text-primary dark:text-white mb-2">
            Accept Invitation
          </h1>
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
            Sign in to join the APIWeave workspace
          </p>
        </div>

        <div className="p-8 flex flex-col gap-3">
          {error && (
            <div className="p-3 mb-2 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm border border-red-200 dark:border-red-800/30">
              {error}
            </div>
          )}

          {providersLoading ? (
            <div className="flex justify-center py-4">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : providerError ? (
            <div className="p-3 mb-2 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm border border-red-200 dark:border-red-800/30 text-center">
              {providerError}
            </div>
          ) : providers.length === 0 ? (
            <div className="p-3 mb-2 rounded bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400 text-sm border border-yellow-200 dark:border-yellow-800/30 text-center">
              No sign-in providers are configured. Contact your administrator.
            </div>
          ) : (
            providers.map((provider) => {
              const Icon = PROVIDER_DISPLAY_MAP[provider.id].IconComponent;

              return (
                <Button
                  key={provider.id}
                  variant="secondary"
                  fullWidth
                  data-provider={provider.id}
                  onClick={() => login(provider.id, token)}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="w-5 h-5" />
                    <span>{provider.label}</span>
                  </div>
                </Button>
              );
            })
          )}
        </div>
      </Card>
    </SplitAuthLayout>
  );
}
