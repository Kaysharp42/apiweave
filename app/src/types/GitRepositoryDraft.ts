import type { GitAccount } from "@shared/types/GitAccount";

/** A repository about to be created, as the create form holds it. */
export interface GitRepositoryDraft {
  /** The account to create it as; null until one is chosen. */
  readonly account: GitAccount | null;
  /** The account itself, or one of its organizations or groups; empty until the owners are listed. */
  readonly owner: string;
  readonly name: string;
  readonly private: boolean;
}
