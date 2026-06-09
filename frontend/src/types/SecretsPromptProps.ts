import type { Environment } from './Environment';

export interface SecretsPromptProps {
  isOpen: boolean;
  environment: Environment | null;
  onClose: () => void;
  onSecretsProvided?: (secrets: Record<string, string>) => void;
}
