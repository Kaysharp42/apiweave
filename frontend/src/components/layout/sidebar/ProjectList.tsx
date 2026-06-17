import { FolderKanban } from 'lucide-react';
import { Button } from '../../atoms/Button';
import { EmptyState } from '../../molecules/EmptyState';
import { ProjectItem } from './ProjectItem';
import type { ProjectListProps } from '../../../types';

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
  onCreateProject,
}: ProjectListProps) {
  if (projects.length === 0) {
    return (
      <EmptyState
        icon={<FolderKanban className="w-12 h-12 text-text-muted dark:text-text-muted-dark" strokeWidth={1.5} />}
        title={searchQuery ? 'No matching projects' : 'No projects yet'}
        description={
          searchQuery
            ? `No projects match "${searchQuery}"`
            : 'Create projects to organize your workflows'
        }
        action={
          !searchQuery && (
            <Button variant="primary" intent="success" size="sm" onClick={onCreateProject} icon={<FolderKanban className="w-4 h-4" />}>
              Create Project
            </Button>
          )
        }
      />
    );
  }

  return (
    <ul className="w-full list-none space-y-1 px-0.5">
      {projects.map((project) => (
        <ProjectItem
          key={project.projectId ?? project.collectionId}
          project={project}
          isExpanded={expandedProjects.has(project.projectId ?? project.collectionId)}
          workflows={workflows}
          projects={projects}
          environments={environments}
          selectedWorkflowId={selectedWorkflowId}
          onToggle={onToggleProject}
          onWorkflowClick={onWorkflowClick}
          onExportProject={onExportProject}
          onDeleteProject={onDeleteProject}
          onExportWorkflow={onExportWorkflow}
          onDeleteWorkflow={onDeleteWorkflow}
        />
      ))}
    </ul>
  );
}
