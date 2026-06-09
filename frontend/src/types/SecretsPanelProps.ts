import type { Environment } from './Environment';

export interface SecretsPanelProps {
  isOpen: boolean;
  environment: Environment | null;
  onSecretsChange?: (secrets: Record<string, string>) => Promise<void>;
  onClose: () => void;
}
