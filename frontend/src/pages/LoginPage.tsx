import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { Button } from '../components/atoms/Button';
import { SplitAuthLayout } from '../components/auth/SplitAuthLayout';
import { AuthInteractiveHero } from '../components/auth/AuthInteractiveHero';
import { Github, Gitlab, Fingerprint } from 'lucide-react';

const GoogleIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

const SSO_PROVIDERS = [
  { id: 'github', label: 'Continue with GitHub', icon: <Github className="w-5 h-5 text-white/80 group-hover:text-white transition-colors" /> },
  { id: 'gitlab', label: 'Continue with GitLab', icon: <Gitlab className="w-5 h-5 text-white/80 group-hover:text-white transition-colors" /> },
  { id: 'microsoft', label: 'Continue with Microsoft', icon: <Fingerprint className="w-5 h-5 text-white/80 group-hover:text-white transition-colors" /> },
  { id: 'google', label: 'Continue with Google', icon: <GoogleIcon className="w-5 h-5 opacity-80 group-hover:opacity-100 transition-opacity grayscale group-hover:grayscale-0" /> },
];

export default function LoginPage() {
  const { login, status } = useAuth();
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');

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
    <SplitAuthLayout hero={<AuthInteractiveHero />}>
      <div className="w-full backdrop-blur-3xl bg-white/5 border border-white/10 shadow-2xl rounded-3xl overflow-hidden relative">
        {/* Inner subtle glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-1 bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent blur-sm" />
        
        <div className="p-10 text-center relative z-10">
          <h1 className="text-3xl font-display font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-cyan-100 to-cyan-300 mb-3 drop-shadow-sm">
            Welcome Back
          </h1>
          <p className="text-sm text-cyan-100/70 font-medium">
            Sign in to APIWeave to continue
          </p>
        </div>

        <div className="px-10 pb-10 flex flex-col gap-4 relative z-10">
          {error && (
            <div className="p-4 mb-2 rounded-xl bg-red-500/10 text-red-200 text-sm border border-red-500/20 backdrop-blur-sm shadow-inner">
              {error}
            </div>
          )}

          {SSO_PROVIDERS.map((provider) => (
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
                {provider.icon}
                <span>{provider.label}</span>
              </div>
            </Button>
          ))}
        </div>
      </div>
    </SplitAuthLayout>
  );
}
