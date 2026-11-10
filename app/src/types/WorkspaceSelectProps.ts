import type { Workspace } from "./Workspace";

export interface WorkspaceSelectProps {
  readonly workspaces: readonly Workspace[];
  readonly value: string;
  readonly onChange: (workspaceId: string) => void;
  readonly disabled: boolean;
  /** The workspace the item currently lives in, when the list marks it. */
  readonly sourceWorkspaceId?: string;
  /** Suffix appended to the source workspace's name, e.g. " (same workspace)". */
  readonly sourceSuffix?: string;
}
