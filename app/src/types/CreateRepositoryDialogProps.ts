import type { GitAccount } from "@shared/types/GitAccount";
import type { GitAccountRef } from "@shared/types/GitAccountRef";
import type { GitCreatedRepository } from "@shared/types/GitCreatedRepository";

export interface CreateRepositoryDialogProps {
  readonly onClose: () => void;
  /** The name the form starts with: the workspace's slug. */
  readonly defaultName: string;
  /** The account the form starts on, when it is still signed in. */
  readonly defaultAccount: GitAccountRef | null;
  /** Told the repository once it exists, and the account it was created as; connecting to it is the caller's. */
  readonly onCreated: (created: GitCreatedRepository, account: GitAccount) => void;
}
