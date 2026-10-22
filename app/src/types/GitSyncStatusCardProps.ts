import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";
import type { GitSyncActions } from "./GitSyncActions";

export interface GitSyncStatusCardProps {
  readonly status: WorkspaceGitStatus;
  readonly actions: GitSyncActions;
  /** Offer Discard local changes whenever there is a remote, not only when the state is stuck. */
  readonly alwaysOfferDiscard?: boolean;
  /** Adds a link to the version-history settings; the settings panel itself leaves it out. */
  readonly settingsPath?: string;
  /** Called when the settings link is followed, so a popover can close. */
  readonly onNavigate?: () => void;
}
