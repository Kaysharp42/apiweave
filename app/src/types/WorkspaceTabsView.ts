import type { WorkspaceTab } from "./WorkspaceTab";

export interface WorkspaceTabsView {
  /** The workspace the slice belongs to; null while the scope is still loading. */
  readonly workspaceId: string | null;
  readonly tabs: readonly WorkspaceTab[];
  readonly activeTabId: string | null;
  readonly activeTab: WorkspaceTab | undefined;
}
