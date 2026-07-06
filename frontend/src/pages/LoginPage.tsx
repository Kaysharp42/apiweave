import { useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Mail, Shield } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { Button } from "../components/atoms/Button";
import { Input } from "../components/atoms/Input";
import { Spinner } from "../components/atoms/Spinner";
import { EmptyState } from "../components/molecules/EmptyState";
import { SplitAuthLayout } from "../components/auth/SplitAuthLayout";
import { AuthInteractiveHero } from "../components/auth/AuthInteractiveHero";
import { OAuthButton } from "../components/OAuthButton";
import { useOAuthProviders } from "../hooks/useOAuthProviders";
import { authenticatedJson } from "../utils/apiweaveClient";
import API_BASE_URL from "../utils/apiweaveClient";
import type { EmailLoginResponse } from "../types";

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
  const [email, setEmail] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

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

  const handleEmailSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setEmailError("Email is required");
      return;
    }

    setEmailSending(true);
    setEmailError(null);
    setEmailMessage(null);
    try {
      const response = await authenticatedJson<EmailLoginResponse>(
        `${API_BASE_URL}/api/auth/email/request`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmedEmail }),
        },
      );
      setEmailMessage(response.message);
    } catch (err) {
      setEmailError(
        err instanceof Error ? err.message : "Failed to send sign-in link",
      );
    } finally {
      setEmailSending(false);
    }
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

          <form onSubmit={handleEmailSubmit} className="flex flex-col gap-3">
            <Input
              type="email"
              label="Email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              disabled={emailSending}
              {...(emailError ? { error: emailError } : {})}
            />
            <Button
              type="submit"
              fullWidth
              loading={emailSending}
              icon={<Mail className="w-4 h-4" aria-hidden="true" />}
            >
              Send sign-in link
            </Button>
            {emailMessage && (
              <p className="rounded-sm border border-status-success/30 bg-status-success/5 px-3 py-2 text-sm text-status-success dark:text-[var(--aw-status-success)]">
                {emailMessage}
              </p>
            )}
          </form>

          {!loadingProviders && !fetchError && providers.length > 0 && (
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border dark:bg-border-dark" />
              <span className="font-mono text-[10px] uppercase text-text-muted dark:text-text-muted-dark">
                or
              </span>
              <div className="h-px flex-1 bg-border dark:bg-border-dark" />
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
            <p className="flex items-center gap-2 rounded-sm border border-border bg-surface-overlay px-3 py-2 text-sm text-text-secondary dark:border-border-dark dark:bg-surface-dark-overlay dark:text-text-secondary-dark">
              <Shield className="h-4 w-4 text-status-warning" />
              No OAuth providers configured. Use email sign-in or contact your
              administrator.
            </p>
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
