import type { GitAccount } from "@shared/types/GitAccount";
import type { GitAccountRef } from "@shared/types/GitAccountRef";
import type { GitCreatedRepository } from "@shared/types/GitCreatedRepository";
import type { GitAccountsFeed } from "./GitAccountsFeed";
import type { GitRepositoryDraft } from "./GitRepositoryDraft";

export interface CreateRepositoryDialogProps {
  readonly onClose: () => void;
  /** The name the form starts with: the workspace's slug. */
  readonly defaultName: string;
  /** The account the form starts on, when it is still signed in. */
  readonly defaultAccount: GitAccountRef | null;
  /** A repository to start from: the one Create workspace was going to make, handed on when its sync stopped. */
  readonly initialDraft?: GitRepositoryDraft;
  /** The accounts, held by the page the dialog opens from: a sign-in made here is seen there too. */
  readonly accounts: GitAccountsFeed;
  /** Told the repository once it exists, and the account it was created as; connecting to it is the caller's. */
  readonly onCreated: (created: GitCreatedRepository, account: GitAccount) => void;
}
