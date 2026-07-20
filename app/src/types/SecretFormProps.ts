import type { SecretScopeType } from "./SecretScopeType";

export interface SecretFormProps {
  scopeType: SecretScopeType;
  scopeId: string;
  onCreated: () => void;
  existingSecretId?: string;
  className?: string;
}
