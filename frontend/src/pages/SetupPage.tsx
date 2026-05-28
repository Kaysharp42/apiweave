import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { Button } from '../components/atoms/Button';
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
  const [providersLoading, setProvidersLoading] = useState(false);

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
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  return (
      <SplitAuthLayout hero={() => <AuthInteractiveHero />}>
      <div className="w-full backdrop-blur-3xl bg-white/5 border border-white/10 shadow-2xl rounded-3xl overflow-hidden relative">
        {/* Inner subtle glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-1 bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent blur-sm" />

        <div className="p-10 text-center relative z-10">
          <h1 className="text-3xl font-display font-extrabold text-cyan-50 mb-3 drop-shadow-sm">
            Setup APIWeave
          </h1>
          <p className="text-sm text-cyan-100/70 font-medium">
            Create the first admin account
          </p>
        </div>

        <div className="px-10 pb-10 flex flex-col gap-4 relative z-10">
          {error && (
            <div className="p-4 mb-2 rounded-xl bg-red-500/10 text-red-200 text-sm border border-red-500/20 backdrop-blur-sm shadow-inner">
              {error}
            </div>
          )}

          {providersLoading ? (
            <>
              <div className="h-[52px] bg-white/5 rounded-xl animate-pulse" />
              <div className="h-[52px] bg-white/5 rounded-xl animate-pulse" />
              <div className="h-[52px] bg-white/5 rounded-xl animate-pulse" />
            </>
          ) : providerError ? (
            <div className="p-4 rounded-xl bg-red-500/10 text-red-200 text-sm border border-red-500/20 backdrop-blur-sm shadow-inner">
              {providerError}
            </div>
          ) : providers.length === 0 ? (
            <div className="p-4 rounded-xl bg-amber-500/10 text-amber-200 text-sm border border-amber-500/20 backdrop-blur-sm shadow-inner">
              No sign-in providers are configured. Contact your administrator.
            </div>
          ) : (
            providers.map((provider) => {
              const display = PROVIDER_DISPLAY_MAP[provider.id as keyof typeof PROVIDER_DISPLAY_MAP];
              if (!display) return null;
              const { IconComponent, label } = display;
              const isGoogle = provider.id === 'google';
              const iconClass = isGoogle
                ? 'w-5 h-5 opacity-80 group-hover:opacity-100 transition-opacity grayscale group-hover:grayscale-0'
                : 'w-5 h-5 text-white/80 group-hover:text-white transition-colors';

              return (
                <Button
                  key={provider.id}
                  variant="ghost"
                  fullWidth
                  size="lg"
                  data-provider={provider.id}
                  onClick={() => login(provider.id)}
                  className="group relative !bg-white/5 hover:!bg-white/10 !border !border-white/5 hover:!border-white/20 !text-white/90 hover:!text-white shadow-sm hover:shadow-[0_0_20px_rgba(34,211,238,0.15)] overflow-hidden transition-all duration-300 rounded-xl font-medium !justify-start pl-6"
                >
                  {/* Button hover glow sweep */}
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full ease-out" style={{ transitionDuration: '1000ms' }} />
                  <div className="flex items-center gap-4 relative z-10 w-full">
                    <IconComponent className={iconClass} />
                    <span>{label}</span>
                  </div>
                </Button>
              );
            })
          )}
        </div>
      </div>
    </SplitAuthLayout>
  );
}
