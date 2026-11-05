import type { GitAccount } from "@shared/types/GitAccount";
import type { GitCreatedRepository } from "@shared/types/GitCreatedRepository";
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";
import type { GitAccountsFeed } from "./GitAccountsFeed";
import type { GitRepositoryCreation } from "./GitRepositoryCreation";
import type { GitRepositoryDraft } from "./GitRepositoryDraft";

/** The dialogs the version history panel can raise over itself. */
export interface VersionHistoryDialogsProps {
  readonly workspaceId: string;
  /** What a repository created for the workspace is called unless the user says otherwise. */
  readonly workspaceSlug: string;
  /** The repository Create workspace was going to make before its sync stopped. */
  readonly handedOn: GitRepositoryDraft | null;
  readonly accounts: GitAccountsFeed;
  readonly creation: GitRepositoryCreation;
  readonly onCloseCreation: () => void;
  readonly onCreated: (created: GitCreatedRepository, account: GitAccount) => void;
  /** A merge a connect started, shown over the panel. */
  readonly merge: WorkspaceGitStatus | null;
  readonly onCloseMerge: () => void;
  readonly switchingBranch: boolean;
  /** The branch a switch would leave, or null while no status has been read. */
  readonly currentBranch: string | null;
  readonly onCloseBranch: () => void;
  readonly onSwitched: (status: WorkspaceGitStatus) => void;
}
