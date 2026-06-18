import type { Workflow } from './Workflow';
import type { Project } from './Project';
import type { Environment } from './Environment';

export interface ProjectItemProps {
  project: Project;
  isExpanded: boolean;
  workflows: Workflow[];
  projects: Project[];
  environments: Environment[];
  selectedWorkflowId: string | null;
  onToggle: (projectId: string) => void;
  onWorkflowClick: (workflow: Workflow) => void;
  onExportProject: (project: Project) => void;
  onDeleteProject: (projectId: string, name: string) => void;
  onExportWorkflow: (workflow: Workflow) => void;
  onDeleteWorkflow: (workflowId: string, name: string) => void;
  onAddWorkflowToProject: (projectId: string) => void;
  onAssignWorkflowToProject: (projectId: string, workflowId: string) => void;
}
