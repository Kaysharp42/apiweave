import { useAuth } from '../auth/useAuth';
import { Button } from '../components/atoms/Button';

const SSO_PROVIDERS: { id: string; label: string }[] = [
  { id: 'google', label: 'Continue with Google' },
  { id: 'github', label: 'Continue with GitHub' },
];

export default function LoginPage() {
  const { login } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface dark:bg-surface-dark">
      <div className="w-full max-w-sm p-8 rounded-xl shadow-lg bg-white dark:bg-surface-elevated border border-border dark:border-border-dark">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-text-primary dark:text-white mb-2">
            Sign in to APIWeave
          </h1>
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
            Choose a provider to continue
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {SSO_PROVIDERS.map((provider) => (
            <Button
              key={provider.id}
              variant="secondary"
              fullWidth
              onClick={() => login(provider.id)}
            >
              {provider.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
