import type { Workflow } from './Workflow';
import type { Project } from './Project';
import type { Environment } from './Environment';

export interface ProjectListProps {
  projects: Project[];
  workflows: Workflow[];
  environments: Environment[];
  selectedWorkflowId: string | null;
  isRefreshing?: boolean;
  searchQuery: string;
  expandedProjects: Set<string>;
  onToggleProject: (projectId: string) => void;
  onWorkflowClick: (workflow: Workflow) => void;
  onExportWorkflow: (workflow: Workflow) => void;
  onDeleteWorkflow: (workflowId: string, name: string) => void;
  onExportProject: (project: Project) => void;
  onDeleteProject: (projectId: string, name: string) => void;
  onCreateProject: () => void;
  onAddWorkflowToProject: (projectId: string) => void;
  onAssignWorkflowToProject: (projectId: string, workflowId: string) => void;
}
