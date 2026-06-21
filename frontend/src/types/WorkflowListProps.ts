import type { Workflow } from './Workflow';
import type { Collection } from './Collection';
import type { ScopedEnvironment } from './ScopedEnvironment';
import type { PaginationState } from './PaginationState';

export interface WorkflowListProps {
  workflows: Workflow[];
  collections: Collection[];
  environments: ScopedEnvironment[];
  selectedWorkflowId: string | null;
  isRefreshing: boolean;
  isLoadingMore: boolean;
  searchQuery: string;
  pagination: PaginationState;
  onWorkflowClick: (workflow: Workflow) => void;
  onExportWorkflow: (workflow: Workflow) => void;
  onDeleteWorkflow: (workflowId: string, name: string) => void;
  onCreateWorkflow: () => void;
  onLoadMore?: () => void;
}