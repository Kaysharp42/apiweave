import type { Secret } from "./Secret";
import type { SecretScopeType } from "./SecretScopeType";

export interface ScopedSecretListProps {
  scopeType: SecretScopeType;
  scopeId: string;
  onChanged: () => void;
  onSelect?: (secret: Secret) => void;
  /** Copy this secret's value into another scope. */
  onDuplicate?: (secret: Secret) => void;
  /** Move this secret's value into another scope. */
  onMove?: (secret: Secret) => void;
  /**
   * Hides Delete. Set for a scope other than the active workspace's: those
   * secrets are listed so the user can see where they live and copy or move
   * them, not so they can be deleted from outside the workspace that owns them.
   */
  readOnly?: boolean;
  selectedId?: string;
  className?: string;
}
