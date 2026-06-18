import { LogOut, User as UserIcon, KeyRound, Loader2 } from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import { useSignOut } from '../hooks/useSignOut';
import { Button } from '../components/atoms/Button';
import { getProviderDisplay } from '../auth/providerConfig';
import type { ProviderId } from '../types';

/**
 * Derive the primary sign-in provider from a user's oauth_accounts.
 * Returns 'local' when the user has a local account or no OAuth accounts.
 */
function resolveProvider(oauthAccounts: Array<{ provider: string }> | undefined): 'local' | ProviderId {
  if (!oauthAccounts || oauthAccounts.length === 0) return 'local';
  const localAccount = oauthAccounts.find((a) => a.provider === 'local');
  if (localAccount) return 'local';
  const firstOAuth = oauthAccounts[0];
  if (firstOAuth && isProviderId(firstOAuth.provider)) return firstOAuth.provider;
  return 'local';
}

function isProviderId(value: string): value is ProviderId {
  return value === 'github' || value === 'gitlab' || value === 'google' || value === 'microsoft';
}

export default function AccountSettingsPage() {
  const { user } = useAuth();
  const { signOut, isSigningOut } = useSignOut();

  if (!user) return null;

  const provider = resolveProvider(user.oauth_accounts);
  const isLocal = provider === 'local';
  const providerDisplay = !isLocal ? getProviderDisplay(provider) : null;
  const ProviderIcon = providerDisplay?.IconComponent;

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <header className="pb-6 border-b border-border dark:border-border-dark">
        <h1 className="text-3xl font-display font-bold tracking-tight text-text-primary dark:text-text-primary-dark">
          Account Settings
        </h1>
        <p className="mt-1 text-sm text-text-secondary dark:text-text-secondary-dark">
          Manage your sign-in method and account preferences.
        </p>
      </header>

      {/* Sign-in method section */}
      <section
        aria-labelledby="signin-method-heading"
        className="rounded border border-border bg-surface-raised p-6 dark:border-border-dark dark:bg-surface-dark-raised"
      >
        <h2
          id="signin-method-heading"
          className="text-lg font-semibold text-text-primary dark:text-text-primary-dark"
        >
          Sign-in method
        </h2>

        {isLocal ? (
          <div className="mt-4 space-y-4">
            <div className="flex items-center gap-3 rounded border border-border bg-surface p-4 dark:border-border-dark dark:bg-surface-dark">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 dark:bg-primary-light/10">
                <UserIcon className="h-5 w-5 text-primary dark:text-primary-light" />
              </div>
              <div>
                <p className="text-sm font-medium text-text-primary dark:text-text-primary-dark">
                  Local account
                </p>
                <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
                  {user.verified_email}
                </p>
              </div>
            </div>

            {/* Change password form placeholder */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-text-primary dark:text-text-primary-dark">
                Change password
              </h3>
              <div className="flex items-center gap-2 text-sm text-text-muted dark:text-text-muted-dark">
                <KeyRound className="h-4 w-4" />
                <span>Password management is not yet available for local accounts.</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="flex items-center gap-3 rounded border border-border bg-surface p-4 dark:border-border-dark dark:bg-surface-dark">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 dark:bg-primary-light/10">
                {ProviderIcon ? (
                  <ProviderIcon className="h-5 w-5 text-primary dark:text-primary-light" />
                ) : (
                  <UserIcon className="h-5 w-5 text-primary dark:text-primary-light" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text-primary dark:text-text-primary-dark">
                  {providerDisplay?.label ?? provider}
                </p>
                <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
                  {user.verified_email}
                </p>
              </div>
            </div>

            <Button
              variant="ghost"
              intent="error"
              size="sm"
              onClick={() => void signOut()}
              disabled={isSigningOut}
              className="w-full sm:w-auto"
            >
              {isSigningOut ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
              {isSigningOut ? 'Signing out…' : `Sign out of ${providerDisplay?.label ?? provider}`}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
