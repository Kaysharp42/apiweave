import type { Workspace } from "./Workspace";

export interface WorkspaceContextValue {
  availableWorkspaces: Workspace[];
  currentWorkspace: Workspace | null;
  currentOrg: { slug?: string; name?: string; orgId?: string } | null;
  orgs: readonly { slug?: string; name?: string; orgId?: string }[];
  switchTo: (workspaceSlug: string) => void;
  refresh: () => Promise<void>;
  isLoading: boolean;
}
