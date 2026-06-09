import type { Workflow } from './Workflow';
import type { Collection } from './Collection';
import type { Environment } from './Environment';

export interface CollectionListProps {
  collections: Collection[];
  workflows: Workflow[];
  environments: Environment[];
  selectedWorkflowId: string | null;
  isRefreshing?: boolean;
  searchQuery: string;
  expandedCollections: Set<string>;
  onToggleCollection: (collectionId: string) => void;
  onWorkflowClick: (workflow: Workflow) => void;
  onExportWorkflow: (workflow: Workflow) => void;
  onDeleteWorkflow: (workflowId: string, name: string) => void;
  onExportCollection: (collection: Collection) => void;
  onDeleteCollection: (collectionId: string, name: string) => void;
  onCreateCollection: () => void;
}