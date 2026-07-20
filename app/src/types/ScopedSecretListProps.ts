import type { Secret } from "./Secret";
import type { SecretScopeType } from "./SecretScopeType";

export interface ScopedSecretListProps {
  scopeType: SecretScopeType;
  scopeId: string;
  onChanged: () => void;
  onSelect?: (secret: Secret) => void;
  selectedId?: string;
  className?: string;
}
