import type { SecretScopeType } from "./SecretScopeType";

export interface SecretValueEditorProps {
  isOpen: boolean;
  scopeType: SecretScopeType;
  scopeId: string;
  workspaceId?: string;
  secretName: string;
  secretId?: string;
  onClose: () => void;
  onSuccess: () => void;
}
