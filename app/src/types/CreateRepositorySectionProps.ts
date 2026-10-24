import type { GitAccountRef } from "@shared/types/GitAccountRef";
import type { GitRepositoryDraft } from "./GitRepositoryDraft";

export interface CreateRepositorySectionProps {
  readonly value: GitRepositoryDraft;
  readonly onChange: (draft: GitRepositoryDraft) => void;
  /** The account to start on once the accounts are listed; the active one, then the first, when it is not signed in, or null. */
  readonly defaultAccount: GitAccountRef | null;
  readonly disabled?: boolean;
}
