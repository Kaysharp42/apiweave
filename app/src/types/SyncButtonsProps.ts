import type { GitSyncActions } from "./GitSyncActions";
import type { GitSyncView } from "./GitSyncView";

export interface SyncButtonsProps {
  readonly view: GitSyncView;
  readonly connected: boolean;
  readonly offerDiscard: boolean;
  readonly actions: GitSyncActions;
}
