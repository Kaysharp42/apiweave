import type { GitSyncKind } from "./GitSyncKind";

export interface GitSyncKindIconProps {
  readonly kind: GitSyncKind;
  /** The workspace has no remote, so its settled state is "committed", not "synced". */
  readonly local: boolean;
  readonly className?: string;
}
