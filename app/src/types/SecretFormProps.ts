import type { SecretScopeType } from "./SecretScopeType";

export interface SecretFormProps {
  scopeType: SecretScopeType;
  scopeId: string;
  onCreated: () => void;
  existingSecretId?: string;
  className?: string;
  /** The name the form opens with, such as a placeholder a recorded step already refers to. */
  defaultName?: string;
}
