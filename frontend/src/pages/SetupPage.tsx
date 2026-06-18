import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Shield } from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import { Button } from '../components/atoms/Button';
import { Spinner } from '../components/atoms/Spinner';
import { Card } from '../components/molecules/Card';
import { EmptyState } from '../components/molecules/EmptyState';
import { SplitAuthLayout } from '../components/auth/SplitAuthLayout';
import { AuthInteractiveHero } from '../components/auth/AuthInteractiveHero';
import type { ProviderInfo } from '../types/ProviderInfo';
import { PROVIDER_DISPLAY_MAP, getEnabledProviders, type ProviderDisplay } from '../auth/providerConfig';
import API_BASE_URL from '../utils/api';
import { authenticatedFetch } from '../utils/authenticatedApi';

export default function SetupPage() {
  const { login, status } = useAuth();
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');
  const [providers, setProviders] = useState<ProviderDisplay[]>([]);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [loadingProviderId, setLoadingProviderId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await authenticatedFetch(`${API_BASE_URL}/api/auth/providers`);
        if (!res.ok) throw new Error('Failed to load providers');
        const data: ProviderInfo[] = await res.json();
        if (!cancelled) {
          setProviders(getEnabledProviders(data));
        }
      } catch {
        if (!cancelled) {
          setProviderError('Unable to load sign-in options');
        }
      } finally {
        if (!cancelled) setProvidersLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface dark:bg-surface-dark">
        <Spinner size="lg" className="text-primary dark:text-primary-light" />
      </div>
    );
  }

  if (status === 'authenticated') {
    return <Navigate to="/personal/workflows" replace />;
  }

  const handleProviderClick = (providerId: string) => {
    setLoadingProviderId(providerId);
    login(providerId);
  };

  return (
    <SplitAuthLayout hero={() => <AuthInteractiveHero />}>
      <Card className="w-full overflow-hidden relative border-border dark:border-border-dark rounded">
        <div className="p-10 text-center relative z-10 border-b border-border dark:border-border-dark">
          <h1 className="text-3xl font-display font-bold tracking-tight text-text-primary dark:text-text-primary-dark mb-3">
            Setup APIWeave
          </h1>
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark font-medium">
            Create the first admin account
          </p>
        </div>

        <div className="px-10 pb-10 flex flex-col gap-4 relative z-10">
          {error && (
            <div className="p-4 mb-2 rounded bg-status-error/10 text-status-error dark:text-[var(--aw-status-error)] text-sm border border-status-error/20">
              {error}
            </div>
          )}

          {providersLoading ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <Spinner size="lg" className="text-primary dark:text-primary-light" />
              <p className="text-sm text-text-muted dark:text-text-muted-dark">Loading sign-in options...</p>
            </div>
          ) : providerError ? (
            <EmptyState
              icon={<AlertTriangle className="w-12 h-12 text-status-error" strokeWidth={1.5} />}
              title="Sign-in options unavailable"
              description={providerError}
            />
          ) : providers.length === 0 ? (
            <EmptyState
              icon={<Shield className="w-12 h-12 text-status-warning" strokeWidth={1.5} />}
              title="No sign-in providers configured"
              description="Contact your administrator to enable authentication providers."
            />
          ) : (
            providers.map((provider) => {
              const display = PROVIDER_DISPLAY_MAP[provider.id as keyof typeof PROVIDER_DISPLAY_MAP];
              if (!display) return null;
              const { IconComponent, label } = display;
              const isGoogle = provider.id === 'google';
              const iconClass = isGoogle
                ? 'w-5 h-5 opacity-80 group-hover:opacity-100 transition-opacity grayscale group-hover:grayscale-0'
                : 'w-5 h-5 text-text-secondary dark:text-text-secondary-dark group-hover:text-text-primary dark:group-hover:text-text-primary-dark transition-colors';
              const isLoading = loadingProviderId === provider.id;
              const isDisabled = loadingProviderId !== null && !isLoading;

              return (
                <Button
                  key={provider.id}
                  variant="outline"
                  fullWidth
                  size="lg"
                  data-provider={provider.id}
                  onClick={() => handleProviderClick(provider.id)}
                  loading={isLoading}
                  disabled={isDisabled}
                  className="group relative overflow-hidden transition-colors duration-200 motion-reduce:transition-none rounded font-medium !justify-start pl-6"
                >
                  <div className="flex items-center gap-4 relative z-10 w-full">
                    <IconComponent className={iconClass} />
                    <span>{label}</span>
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
