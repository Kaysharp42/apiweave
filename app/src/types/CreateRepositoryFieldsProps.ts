import type { GitAccount } from "@shared/types/GitAccount";
import type { GitRepositoryDraft } from "./GitRepositoryDraft";

export interface CreateRepositoryFieldsProps {
  readonly value: GitRepositoryDraft;
  readonly onChange: (draft: GitRepositoryDraft) => void;
  /** Every account `gh` and `glab` are signed in to. */
  readonly accounts: readonly GitAccount[];
  readonly disabled?: boolean;
}
