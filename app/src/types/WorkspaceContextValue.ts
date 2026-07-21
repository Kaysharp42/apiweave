import type { Workspace } from "./Workspace";
import type { WorkspaceEntry } from "./WorkspaceEntry";

export type { WorkspaceEntry } from "./WorkspaceEntry";

export interface WorkspaceContextValue {
  availableWorkspaces: WorkspaceEntry[];
  currentWorkspace: Workspace | null;
  currentOrg: { slug?: string; name?: string; orgId?: string } | null;
  orgs: readonly { slug?: string; name?: string; orgId?: string }[];
  currentRole: string | null;
  switchTo: (workspaceSlug: string) => void;
  refresh: () => Promise<void>;
  isLoading: boolean;
}
