import type { Organization } from "./Organization";
import type { Workspace } from "./Workspace";

/** Entry in the workspace switcher — an org + workspace pair. */
export interface WorkspaceEntry {
  org: Organization | null;
  workspace: Workspace;
  role: string;
}

/** Shape of the WorkspaceContext consumed by the whole app. */
export interface WorkspaceContextValue {
  /** All orgs the current user belongs to. */
  orgs: Organization[];
  /** All workspaces accessible to the current user (personal + org). */
  availableWorkspaces: WorkspaceEntry[];
  /** Currently selected organization (null when on personal workspace). */
  currentOrg: Organization | null;
  /** Currently selected workspace. */
  currentWorkspace: Workspace | null;
  /** Role the user holds in the current workspace. */
  currentRole: string | null;
  /** Navigate to a different org/workspace by slug pair. */
  switchTo: (orgSlug: string, workspaceSlug: string) => void;
  refresh: () => Promise<void>;
  /** Whether the context is still loading data. */
  isLoading: boolean;
}
