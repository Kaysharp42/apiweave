import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Shield } from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import { Spinner } from '../components/atoms/Spinner';
import { Card } from '../components/molecules/Card';
import { EmptyState } from '../components/molecules/EmptyState';
import { SplitAuthLayout } from '../components/auth/SplitAuthLayout';
import { AuthInteractiveHero } from '../components/auth/AuthInteractiveHero';
import { OAuthButton } from '../components/OAuthButton';
import { useOAuthProviders } from '../hooks/useOAuthProviders';

export default function LoginPage() {
  const { login, status } = useAuth();
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');

  const { providers, loading: loadingProviders, error: fetchError } = useOAuthProviders();
  const [loadingProviderId, setLoadingProviderId] = useState<string | null>(null);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface dark:bg-surface-dark">
        <Spinner size="lg" className="text-primary dark:text-primary-light" />
      </div>
    );
  }

  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  const handleProviderClick = (providerId: string) => {
    setLoadingProviderId(providerId);
    login(providerId);
  };

  return (
    <SplitAuthLayout hero={() => <AuthInteractiveHero />}>
      <Card className="w-full shadow-modal rounded-xl overflow-hidden relative">
        {/* Inner subtle glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-1 bg-gradient-to-r from-transparent via-[var(--aw-primary)]/30 to-transparent blur-sm" />

        <div className="p-10 text-center relative z-10">
          <h1 className="text-3xl font-display font-extrabold text-text-primary dark:text-text-primary-dark mb-3 drop-shadow-sm">
            Welcome Back
          </h1>
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark font-medium">
            Sign in to APIWeave to continue
          </p>
        </div>

        <div className="px-10 pb-10 flex flex-col gap-4 relative z-10">
          {error && (
            <div className="p-4 mb-2 rounded-lg bg-status-error/10 text-status-error dark:text-[var(--aw-status-error)] text-sm border border-status-error/20 shadow-inner">
              {error}
            </div>
          )}

          {fetchError && (
            <EmptyState
              icon={<AlertTriangle className="w-12 h-12 text-status-error" strokeWidth={1.5} />}
              title="Sign-in options unavailable"
              description={fetchError}
            />
          )}

          {loadingProviders && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Spinner size="lg" className="text-primary dark:text-primary-light" />
              <p className="text-sm text-text-muted dark:text-text-muted-dark">Loading sign-in options...</p>
            </div>
          )}

          {!loadingProviders && !fetchError && providers.length === 0 && (
            <EmptyState
              icon={<Shield className="w-12 h-12 text-status-warning" strokeWidth={1.5} />}
              title="No sign-in providers configured"
              description="Contact your administrator to enable authentication providers."
            />
          )}

          {!loadingProviders && providers.map((provider) => {
            const isLoading = loadingProviderId === provider.id;
            const isDisabled = loadingProviderId !== null && !isLoading;

            return (
              <OAuthButton
                key={provider.id}
                provider={provider}
                onClick={handleProviderClick}
                loading={isLoading}
                disabled={isDisabled}
              />
            );
          })}
        </div>
      </Card>
    </SplitAuthLayout>
  );
}
