import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";

export interface TrackedGitSyncControlProps {
  readonly status: WorkspaceGitStatus;
  readonly apply: (status: WorkspaceGitStatus) => void;
  readonly settingsPath: string;
}
