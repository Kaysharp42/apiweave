import type { Workflow } from "./Workflow";
import type { Project } from "./Project";
import type { PaginationState } from "./PaginationState";

export interface SidebarState {
  workflows: Workflow[];
  allWorkflows: Workflow[];
  collections: Project[];
  pagination: PaginationState;
  isRefreshing: boolean;
  isLoadingMore: boolean;
  searchQuery: string;
  workflowVersion: number;
  collectionVersion: number;
  setSearchQuery: (q: string) => void;
  signalWorkflowsRefresh: () => void;
  signalCollectionsRefresh: () => void;
  fetchWorkflows: (
    skip?: number,
    append?: boolean,
    limit?: number,
    includeAttached?: boolean,
  ) => Promise<void>;
  fetchAllWorkflows: (skip?: number, append?: boolean) => Promise<void>;
  fetchCollections: () => Promise<void>;
  refreshAll: (selectedNav: string) => Promise<void>;
  setIsRefreshing: (v: boolean) => void;
  setIsLoadingMore: (v: boolean) => void;
  resetPagination: () => void;
}
