import type { GitRemoteSelection } from "./GitRemoteSelection";

/** The remote whose branches are listed, and the branch chosen from them. */
export interface RemoteBranchChooserProps {
  readonly selection: GitRemoteSelection;
  /** The branch chosen, or "" for the remote's default branch. */
  readonly branch: string;
  /** The line under the field: what the chosen branch means for this workspace. */
  readonly hint: string;
  /** A submit is under way, so neither the list nor the choice may change. */
  readonly disabled: boolean;
  readonly onBranchChange: (branch: string) => void;
}
