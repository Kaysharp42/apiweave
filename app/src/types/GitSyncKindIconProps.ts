import type { GitSyncIndicator } from "./GitSyncIndicator";

export interface GitSyncKindIconProps {
  /** The state whose icon to draw; a state with no icon draws nothing. */
  readonly indicator: GitSyncIndicator;
  readonly className?: string;
}
