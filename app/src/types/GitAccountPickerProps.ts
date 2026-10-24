import type { GitAccount } from "@shared/types/GitAccount";
import type { GitAccountRef } from "@shared/types/GitAccountRef";

export interface GitAccountPickerProps {
  /** Every account `gh` and `glab` are signed in to. */
  readonly accounts: readonly GitAccount[];
  /** The remote's host, when known: only accounts there are offered. */
  readonly host: string | null;
  /** The chosen account; null for the user's own credential helper or SSH key. */
  readonly value: GitAccountRef | null;
  readonly onChange: (account: GitAccountRef | null) => void;
  readonly disabled?: boolean;
}
