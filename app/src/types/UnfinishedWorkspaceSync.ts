import type { GitRepositoryDraft } from "./GitRepositoryDraft";

/** A workspace created whose sync did not finish: what to say, where to finish it, and the repository it was to be given. */
export interface UnfinishedWorkspaceSync {
  readonly slug: string;
  readonly message: string;
  /** The create form's repository, handed to Version history so its Create repository starts from it. */
  readonly draft: GitRepositoryDraft;
}
