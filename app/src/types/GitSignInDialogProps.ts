import type { GitAccountRef } from "@shared/types/GitAccountRef";
import type { GitProvider } from "@shared/types/GitProvider";

export interface GitSignInDialogProps {
  readonly isOpen: boolean;
  readonly provider: GitProvider;
  /** The host the Host field starts with; the user may change it before signing in. */
  readonly defaultHost: string;
  readonly onClose: () => void;
  /** Told the account once the browser part is done and the tool has stored it. */
  readonly onSignedIn: (account: GitAccountRef) => void;
}
