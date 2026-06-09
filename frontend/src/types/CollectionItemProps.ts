import type { Workflow } from './Workflow';
import type { Collection } from './Collection';
import type { Environment } from './Environment';

export interface CollectionItemProps {
  collection: Collection;
  isExpanded: boolean;
  workflows: Workflow[];
  collections: Collection[];
  environments: Environment[];
  selectedWorkflowId: string | null;
  onToggle: (collectionId: string) => void;
  onWorkflowClick: (workflow: Workflow) => void;
  onExportCollection: (collection: Collection) => void;
  onDeleteCollection: (collectionId: string, name: string) => void;
  onExportWorkflow: (workflow: Workflow) => void;
  onDeleteWorkflow: (workflowId: string, name: string) => void;
}