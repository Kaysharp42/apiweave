import type { GitAccount } from "@shared/types/GitAccount";
import type { GitAccountRef } from "@shared/types/GitAccountRef";
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";
import type { GitAccountsFeed } from "./GitAccountsFeed";
import type { GitRemoteSelection } from "./GitRemoteSelection";

/** What the version history panel shows: its state, and how to act on it. */
export interface VersionHistoryPanelBodyProps {
  /** The desktop bridge answered: version history exists only there. */
  readonly available: boolean;
  readonly status: WorkspaceGitStatus | null;
  /** The panel's own error, or why the status could not be read. */
  readonly shownError: string | null;
  /** A call is under way, so nothing else may start. */
  readonly busy: boolean;
  readonly workspaceId: string;
  /** A repository created but not connected to starts the connect form over, filled in. */
  readonly prefill: GitRemoteSelection | null;
  readonly accounts: GitAccountsFeed;
  readonly apply: (status: WorkspaceGitStatus) => void;
  /** Run one call, show its status, and show its failure worded by `describe`. */
  readonly run: (
    action: () => Promise<WorkspaceGitStatus>,
    describe?: (error: unknown) => string,
  ) => Promise<WorkspaceGitStatus | null>;
  readonly connectTo: (
    url: string,
    account: GitAccountRef | null,
    branch?: string,
  ) => void;
  readonly onCreateRepository: (account: GitAccount) => void;
  readonly onDisconnect: () => void;
  readonly onSwitchBranch: () => void;
  readonly onUntrack: () => void;
}
