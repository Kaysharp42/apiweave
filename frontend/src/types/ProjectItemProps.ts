import type { Workflow } from "./Workflow";
import type { Project } from "./Project";
import type { ScopedEnvironment } from "./ScopedEnvironment";

export interface ProjectItemProps {
  project: Project;
  isExpanded: boolean;
  workflows: Workflow[];
  projects: Project[];
  environments: ScopedEnvironment[];
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
