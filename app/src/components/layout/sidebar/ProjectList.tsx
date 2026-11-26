import { FolderKanban } from "lucide-react";
import { ProjectItem } from "./ProjectItem";
import { SidebarListEmptyState } from "./SidebarListEmptyState";
import type { ProjectListProps } from "../../../types";

/**
 * Renders the project list section of the sidebar.
 * Shows empty state or list of expandable project items.
 */
export function ProjectList({
  projects,
  workflows,
  environments,
  selectedWorkflowId,
  searchQuery,
  expandedProjects,
  onToggleProject,
  onWorkflowClick,
  onExportWorkflow,
  onDeleteWorkflow,
  onExportProject,
  onDeleteProject,
  onRenameProject,
  onMoveProjectToWorkspace,
  onRenameWorkflow,
  onMoveWorkflowToProject,
  onMoveWorkflowToWorkspace,
  onCreateProject,
  onAddWorkflowToProject,
  onAssignWorkflowToProject,
}: ProjectListProps) {
  // fallow-ignore-next-line code-duplication -- the empty-state-or-rows shape WorkflowList shares is the whole of a sidebar list; the empty state itself is shared as SidebarListEmptyState, and the rows differ.
  if (projects.length === 0) {
    return (
      <SidebarListEmptyState
        icon={FolderKanban}
        items="projects"
        emptyDescription="Create projects to organize your workflows"
        createLabel="Create Project"
        searchQuery={searchQuery}
        onCreate={onCreateProject}
      />
    );
  }

  return (
    <ul className="w-full list-none space-y-1 px-0.5 font-sans">
      {projects.map((project) => (
        <ProjectItem
          key={project.collectionId}
          project={project}
          isExpanded={expandedProjects.has(project.collectionId)}
          workflows={workflows}
          projects={projects}
          environments={environments}
          selectedWorkflowId={selectedWorkflowId}
          onToggle={onToggleProject}
          onWorkflowClick={onWorkflowClick}
          onExportProject={onExportProject}
          onDeleteProject={onDeleteProject}
          onRenameProject={onRenameProject}
          onMoveProjectToWorkspace={onMoveProjectToWorkspace}
          onExportWorkflow={onExportWorkflow}
          onDeleteWorkflow={onDeleteWorkflow}
          onRenameWorkflow={onRenameWorkflow}
          onMoveWorkflowToProject={onMoveWorkflowToProject}
          onMoveWorkflowToWorkspace={onMoveWorkflowToWorkspace}
          onAddWorkflowToProject={onAddWorkflowToProject}
          onAssignWorkflowToProject={onAssignWorkflowToProject}
        />
      ))}
    </ul>
  );
}
