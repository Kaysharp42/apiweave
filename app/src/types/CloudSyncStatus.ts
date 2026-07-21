import type { CloudAccountIdentity } from "./CloudAccountIdentity";
import type { CloudDeviceStatus } from "./CloudDeviceStatus";
import type { CloudLinkState } from "./CloudLinkState";
import type { CloudSyncState } from "./CloudSyncState";
import type { CloudWorkspaceBinding } from "./CloudWorkspaceBinding";
import type { CloudWorkspaceCatalogEntry } from "./CloudWorkspaceCatalogEntry";

export interface CloudSyncStatus {
  readonly linked: boolean;
  readonly active: boolean;
  readonly linkState: CloudLinkState;
  readonly syncState: CloudSyncState;
  readonly state: CloudSyncState;
  readonly pendingCount: number;
  readonly deadLetterCount: number;
  readonly conflictCount: number;
  readonly lastSyncedAt?: string;
  readonly lastError?: string;
  readonly deviceId?: string;
  readonly device?: CloudDeviceStatus;
  readonly account?: CloudAccountIdentity;
  readonly workspaceIds: readonly string[];
  readonly bindings: readonly CloudWorkspaceBinding[];
  readonly workspaceCatalog: readonly CloudWorkspaceCatalogEntry[];
}
