import type { CloudBindWorkspaceInput } from "./CloudBindWorkspaceInput";
import type { CloudFailedRecord } from "./CloudFailedRecord";
import type { CloudSyncStatus } from "./CloudSyncStatus";
import type { CloudUnlinkOptions } from "./CloudUnlinkOptions";

export interface UseCloudSync {
  readonly status: CloudSyncStatus | null;
  readonly loading: boolean;
  readonly unavailable: boolean;
  readonly busy: boolean;
  readonly refresh: () => Promise<void>;
  readonly link: (deviceLabel?: string) => Promise<CloudSyncStatus>;
  readonly cancelLink: () => Promise<CloudSyncStatus>;
  readonly unlink: (options?: CloudUnlinkOptions) => Promise<CloudSyncStatus>;
  readonly bindWorkspace: (
    input: CloudBindWorkspaceInput,
  ) => Promise<CloudSyncStatus>;
  readonly unbindWorkspace: (workspaceId: string) => Promise<CloudSyncStatus>;
  readonly initializeWorkspace: (
    workspaceId: string,
  ) => Promise<CloudSyncStatus>;
  readonly refreshWorkspaceCatalog: () => Promise<CloudSyncStatus>;
  readonly retryDeadLetters: (workspaceId: string) => Promise<CloudSyncStatus>;
  readonly discardDeadLetters: (workspaceId: string) => Promise<CloudSyncStatus>;
  readonly listFailedRecords: (
    workspaceId: string,
  ) => Promise<readonly CloudFailedRecord[]>;
  readonly pull: () => Promise<CloudSyncStatus>;
  readonly push: () => Promise<CloudSyncStatus>;
}
