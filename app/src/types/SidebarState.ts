import type { Workflow } from "./Workflow";
import type { Project } from "./Project";

export interface SidebarState {
  workflows: Workflow[];
  allWorkflows: Workflow[];
  collections: Project[];
  /** Workspace-scoped projects (fetched from /api/workspaces/{id}/projects). */
  projects: Project[];
  isRefreshing: boolean;
  searchQuery: string;
  workflowVersion: number;
  collectionVersion: number;
  projectVersion: number;
  /** Currently active workspace ID for scoped fetching. */
  activeWorkspaceId: string | null;
  setSearchQuery: (q: string) => void;
  signalWorkflowsRefresh: () => void;
  /**
   * Merge one authoritative workflow into the cached lists in place. A live
   * canvas update only needs the row it changed — a full refetch here would
   * replace the visible list on every applied snapshot.
   * Falls back to the refresh signal only when the change moves the row into a
   * list it is not cached in, which no in-place edit can position.
   */
  applyWorkflowChange: (workflow: Workflow) => void;
  signalCollectionsRefresh: () => void;
  signalProjectsRefresh: () => void;
  setActiveWorkspaceId: (workspaceId: string | null) => void;
  fetchWorkflows: () => Promise<void>;
  fetchAllWorkflows: () => Promise<void>;
  fetchCollections: () => Promise<void>;
  fetchProjects: () => Promise<void>;
  refreshAll: (selectedNav: string) => Promise<void>;
  setIsRefreshing: (v: boolean) => void;
}
