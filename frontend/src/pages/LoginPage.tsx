import { useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Shield } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { Spinner } from "../components/atoms/Spinner";
import { EmptyState } from "../components/molecules/EmptyState";
import { SplitAuthLayout } from "../components/auth/SplitAuthLayout";
import { AuthInteractiveHero } from "../components/auth/AuthInteractiveHero";
import { OAuthButton } from "../components/OAuthButton";
import { useOAuthProviders } from "../hooks/useOAuthProviders";

export default function LoginPage() {
  const { login, status } = useAuth();
  const [searchParams] = useSearchParams();
  const error = searchParams.get("error");

  const {
    providers,
    loading: loadingProviders,
    error: fetchError,
  } = useOAuthProviders();
  const [loadingProviderId, setLoadingProviderId] = useState<string | null>(
    null,
  );

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface dark:bg-surface-dark">
        <Spinner size="lg" className="text-primary dark:text-primary-light" />
      </div>
    );
  }

  if (status === "authenticated") {
    return <Navigate to="/app" replace />;
  }

  const handleProviderClick = (providerId: string) => {
    setLoadingProviderId(providerId);
    login(providerId);
  };

  return (
    <SplitAuthLayout hero={() => <AuthInteractiveHero />}>
      <div className="flex flex-col w-full max-w-sm md:max-w-md lg:max-w-lg">
        {/* Oversized typographic hierarchy — Swiss minimalism */}
        <h1 className="font-display font-extrabold tracking-tight text-text-primary dark:text-text-primary-dark text-[clamp(2.25rem,4vw,3.5rem)] leading-[0.95]">
          Sign in
        </h1>
        <p className="mt-3 text-sm text-text-secondary dark:text-text-secondary-dark">
          to your APIWeave workspace
        </p>

        <div className="my-8 h-px bg-border dark:bg-border-dark" />

        <div className="flex flex-col gap-4">
          {error && (
            <div className="border border-status-error/30 bg-status-error/5 text-status-error dark:text-[var(--aw-status-error)] text-sm px-4 py-3 rounded-sm">
              {error}
            </div>
          )}

          {fetchError && (
            <EmptyState
              icon={
                <AlertTriangle
                  className="w-10 h-10 text-status-error"
                  strokeWidth={1.5}
                />
              }
              title="Sign-in options unavailable"
              description={fetchError}
            />
          )}

          {loadingProviders && (
            <div className="flex flex-col items-center gap-3 py-10">
              <Spinner
                size="lg"
                className="text-primary dark:text-primary-light"
              />
              <p className="font-mono text-xs text-text-muted dark:text-text-muted-dark">
                Loading sign-in options...
              </p>
            </div>
          )}

          {!loadingProviders && !fetchError && providers.length === 0 && (
            <EmptyState
              icon={
                <Shield
                  className="w-10 h-10 text-status-warning"
                  strokeWidth={1.5}
                />
              }
              title="No sign-in providers configured"
              description="Contact your administrator to enable authentication providers."
            />
          )}

          {!loadingProviders &&
            providers.map((provider) => {
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

        <p className="mt-10 font-mono text-[10px] text-text-muted dark:text-text-muted-dark">
          Open-source. Self-hosted. MIT licensed.
        </p>
      </div>
    </SplitAuthLayout>
  );
}
