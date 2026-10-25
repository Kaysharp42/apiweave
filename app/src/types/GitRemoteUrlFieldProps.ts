import type { GitAccount } from "@shared/types/GitAccount";

export interface GitRemoteUrlFieldProps {
  readonly url: string;
  readonly onChange: (url: string) => void;
  /** The account an `https://` URL on its host is reached as; null: the user's own git sign-in, for any host. */
  readonly account: GitAccount | null;
  /** Back to the account's list; only offered with an account. */
  readonly onBackToList: () => void;
  readonly disabled: boolean;
}
