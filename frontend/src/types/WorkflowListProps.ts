import type { Workflow } from "./Workflow";
import type { Project } from "./Project";
import type { ScopedEnvironment } from "./ScopedEnvironment";
import type { PaginationState } from "./PaginationState";

export interface WorkflowListProps {
  workflows: Workflow[];
  collections: Project[];
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
