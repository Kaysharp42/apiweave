import type { Workflow } from './Workflow';
import type { Collection } from './Collection';
import type { Environment } from './Environment';
import type { PaginationState } from './PaginationState';

export interface SidebarState {
  workflows: Workflow[];
  collections: Collection[];
  environments: Environment[];
  pagination: PaginationState;
  isRefreshing: boolean;
  isLoadingMore: boolean;
  searchQuery: string;
  workflowVersion: number;
  collectionVersion: number;
  environmentVersion: number;
  setSearchQuery: (q: string) => void;
  signalWorkflowsRefresh: () => void;
  signalCollectionsRefresh: () => void;
  signalEnvironmentsRefresh: () => void;
  fetchWorkflows: (skip?: number, append?: boolean, limit?: number, endpoint?: string) => Promise<void>;
  fetchCollections: () => Promise<void>;
  fetchEnvironments: () => Promise<void>;
  refreshAll: (selectedNav: string) => Promise<void>;
  setIsRefreshing: (v: boolean) => void;
  setIsLoadingMore: (v: boolean) => void;
  resetPagination: () => void;
}
