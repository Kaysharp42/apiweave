import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";
import type { Workspace } from "./Workspace";

export interface WorkspaceItemProps {
  readonly workspace: Workspace;
  readonly index: number;
  readonly isActive: boolean;
  readonly icon: ReactNode;
  readonly source: string;
  /** This row's git status; null while it is unknown or when the workspace is not tracked. */
  readonly syncStatus: WorkspaceGitStatus | null;
  readonly onSelect: (workspace: Workspace) => void;
  readonly onKeyDown: (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => void;
  readonly itemRef: (el: HTMLButtonElement | null) => void;
}
