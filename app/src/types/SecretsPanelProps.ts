import type { ScopedEnvironment } from "./ScopedEnvironment";

export interface SecretsPanelProps {
  isOpen: boolean;
  environment: ScopedEnvironment | null;
  onClose: () => void;
}
