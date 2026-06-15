import type { ProviderDisplay } from '../types';
import { Button } from './atoms/Button';

interface OAuthButtonProps {
  provider: ProviderDisplay;
  onClick: (providerId: string) => void;
  loading?: boolean;
  disabled?: boolean;
}

export function OAuthButton({ provider, onClick, loading = false, disabled = false }: OAuthButtonProps) {
  const { IconComponent, label, id } = provider;
  const isGoogle = id === 'google';
  
  const iconClass = isGoogle
    ? 'w-5 h-5 opacity-80 group-hover:opacity-100 transition-opacity grayscale group-hover:grayscale-0'
    : 'w-5 h-5 text-text-secondary dark:text-text-secondary-dark group-hover:text-text-primary dark:group-hover:text-text-primary-dark transition-colors';

  return (
    <Button
      variant="secondary"
      fullWidth
      size="lg"
      data-provider={id}
      onClick={() => onClick(id)}
      loading={loading}
      disabled={disabled}
      className="group relative overflow-hidden transition-all duration-300 rounded-xl font-medium !justify-start pl-6"
    >
      <div className="flex items-center gap-4 relative z-10 w-full">
        <IconComponent className={iconClass} />
        <span>{label}</span>
      </div>
    </Button>
  );
}
