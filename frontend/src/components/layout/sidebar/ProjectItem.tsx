import { ChevronDown, ChevronRight, FolderKanban, Download, Trash2 } from 'lucide-react';
import { Badge } from '../../atoms/Badge';
import { SidebarAction } from './SidebarAction';
import { WorkflowItem } from './WorkflowItem';
import { getSidebarItemLabel } from '../../../utils/sidebarItemLabel';
import type { ProjectItemProps } from '../../../types';

/**
 * Renders a single project item with expand/collapse toggle,
 * nested workflow list, and action buttons (export, delete).
 */
export function ProjectItem({
  project,
  isExpanded,
  workflows,
  projects,
  environments,
  selectedWorkflowId,
  onToggle,
  onWorkflowClick,
  onExportProject,
  onDeleteProject,
  onExportWorkflow,
  onDeleteWorkflow,
}: ProjectItemProps) {
  const projectId = project.projectId ?? project.collectionId;
  const projectWorkflows = Array.isArray(workflows)
    ? workflows.filter((wf) => wf.collectionId === projectId)
    : [];
  const projectLabel = getSidebarItemLabel(project.name, 40, 'Untitled project');

  return (
    <li>
      <div className="group flex items-center gap-2 rounded-xl border border-transparent px-2.5 py-2 transition-all hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay hover:border-[var(--aw-border)]/70">
        <button
          type="button"
          className={[
            'flex min-w-0 flex-1 items-center gap-2 text-left',
            'focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]',
            'cursor-pointer rounded',
          ].join(' ')}
          onClick={() => onToggle(projectId)}
          aria-expanded={isExpanded}
        >
          {isExpanded
            ? <ChevronDown className="w-3.5 h-3.5 text-text-muted dark:text-text-muted-dark flex-shrink-0" />
            : <ChevronRight className="w-3.5 h-3.5 text-text-muted dark:text-text-muted-dark flex-shrink-0" />}
          <FolderKanban className="w-4 h-4 text-[var(--aw-primary)] flex-shrink-0" />
          <span
            className="font-medium text-text-primary dark:text-text-primary-dark truncate"
            title={projectLabel.fullLabel}
          >
            {projectLabel.label}
          </span>
          <Badge variant="ghost" size="xs">{projectWorkflows.length}</Badge>
        </button>

        <div className="ml-1 flex w-[64px] shrink-0 items-center justify-end gap-1">
          <SidebarAction
            icon={Download}
            label="Export project"
            onClick={(event) => {
              event.stopPropagation();
              onExportProject(project);
            }}
          />

          <SidebarAction
            icon={Trash2}
            label="Delete project permanently"
            destructive
            onClick={(event) => {
              event.stopPropagation();
              onDeleteProject(projectId, project.name);
            }}
          />
        </div>
      </div>

      {isExpanded && (
        <ul className="relative ml-3 mt-0.5 space-y-1 pl-3 before:absolute before:bottom-0 before:left-0 before:top-0 before:w-px before:bg-[var(--aw-border)]">
          {projectWorkflows.length === 0 ? (
            <li className="py-3 text-center">
              <span className="text-xs text-text-muted dark:text-text-muted-dark">
                No workflows in this project
              </span>
            </li>
          ) : (
            projectWorkflows.map((workflow) => (
              <WorkflowItem
                key={workflow.workflowId}
                workflow={workflow}
                isActive={selectedWorkflowId === workflow.workflowId}
                collections={projects.map((p) => ({
                  collectionId: p.projectId ?? p.collectionId,
                  name: p.name,
                }))}
                environments={environments}
                onWorkflowClick={onWorkflowClick}
                onExportWorkflow={onExportWorkflow}
                onDeleteWorkflow={onDeleteWorkflow}
              />
            ))
          )}
        </ul>
      )}
    </li>
  );
}
