import type { ScopedEnvironment } from "./ScopedEnvironment";

export interface SecretsPanelProps {
  isOpen: boolean;
  environment: ScopedEnvironment | null;
  onSecretsChange?: (secrets: Record<string, string>) => Promise<void>;
  onClose: () => void;
}
