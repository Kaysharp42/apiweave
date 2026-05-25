import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { Button } from '../components/atoms/Button';
import { Card } from '../components/molecules/Card';
import { SplitAuthLayout } from '../components/auth/SplitAuthLayout';
import { AuthInteractiveHero } from '../components/auth/AuthInteractiveHero';

const SSO_PROVIDERS = [
  { id: 'github', label: 'Continue with GitHub' },
  { id: 'gitlab', label: 'Continue with GitLab' },
  { id: 'microsoft', label: 'Continue with Microsoft' },
  { id: 'google', label: 'Continue with Google' },
];

export default function SetupPage() {
  const { login, status } = useAuth();
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');

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
            Setup APIWeave
          </h1>
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
            Create the first admin account
          </p>
        </div>

        <div className="p-8 flex flex-col gap-3">
          {error && (
            <div className="p-3 mb-2 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm border border-red-200 dark:border-red-800/30">
              {error}
            </div>
          )}

          {SSO_PROVIDERS.map((provider) => (
            <Button
              key={provider.id}
              variant="secondary"
              fullWidth
              data-provider={provider.id}
              onClick={() => login(provider.id)}
            >
              {provider.label}
            </Button>
          ))}
        </div>
      </Card>
    </SplitAuthLayout>
  );
}
